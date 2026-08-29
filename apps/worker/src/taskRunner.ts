import { TaskStateMachine } from "@maddox-bot/agent-core";
import type { AgentTaskRecord, RepositoryRecord } from "@maddox-bot/database";
import type { TaskState } from "@maddox-bot/shared";
import { runImplementationPhase } from "./implementationPhase.js";
import { runPlannerPhase } from "./plannerPhase.js";
import type { WorkerDependencies } from "./workerDependencies.js";

// Stages the Implementation Agent's own external side effects (a pushed branch, an opened PR) are
// reached from. A worker crash anywhere in here loses the in-progress sandbox/conversation
// entirely (see workspace.ts) — there is no partial-loop state left to resume, only "does a PR
// already exist for this task or not".
const IMPLEMENTATION_IN_PROGRESS_STATES: readonly TaskState[] = [
  "IMPLEMENTING",
  "TESTING",
  "FIXING",
  "SELF_REVIEW",
  "PR_CREATED",
];

export async function requireTask(
  deps: WorkerDependencies,
  taskId: string,
): Promise<AgentTaskRecord> {
  const task = await deps.database.agentTasks.findById(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

async function requireRepository(
  deps: WorkerDependencies,
  repositoryId: string,
): Promise<RepositoryRecord> {
  const repository = await deps.database.repositories.findById(repositoryId);
  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }
  return repository;
}

/** The most recent plan_approval for this task, if one exists — a task only ever has one, but
 * "most recent" is still the honest read in case that ever changes. */
async function findPlanApproval(deps: WorkerDependencies, taskId: string) {
  const approvals = await deps.database.approvals.listByTask(taskId);
  return approvals.find((approval) => approval.kind === "plan_approval") ?? null;
}

async function buildPlanApprovalSummary(
  deps: WorkerDependencies,
  task: AgentTaskRecord,
): Promise<string> {
  const plan = task.plan as { summary?: string } | null;
  if (task.jiraIssueId) {
    const jiraIssue = await deps.database.jiraIssues.findById(task.jiraIssueId);
    if (jiraIssue) {
      return `${jiraIssue.issueKey}: ${plan?.summary ?? jiraIssue.summary}`;
    }
  }
  return plan?.summary ?? "Implementation plan";
}

/**
 * Recovers a task left mid-flight by a crashed worker, so runTask always starts from a state it
 * knows how to drive forward. ANALYZING has no external side effects (the Planner never writes
 * anything outside Postgres), so it's always safe to restart from CREATED. The Implementation
 * Agent's in-progress states are only safe to blindly restart from AWAITING_APPROVAL if no PR was
 * created yet — if one was, the task is substantively done and gets fast-forwarded to
 * AWAITING_HUMAN_REVIEW instead of risking a second, duplicate PR.
 */
export async function recoverIfStuck(
  deps: WorkerDependencies,
  task: AgentTaskRecord,
): Promise<AgentTaskRecord> {
  const stateMachine = new TaskStateMachine(deps.database);

  if (task.state === "ANALYZING") {
    await stateMachine.forceRecover(task.id, "CREATED", "worker_restarted_from_ANALYZING");
    return requireTask(deps, task.id);
  }

  if (IMPLEMENTATION_IN_PROGRESS_STATES.includes(task.state)) {
    const existingPr = await deps.database.pullRequests.findByTaskId(task.id);
    if (existingPr) {
      await stateMachine.forceRecover(
        task.id,
        "AWAITING_HUMAN_REVIEW",
        "pull_request_already_existed",
      );
      deps.logger.info(
        { taskId: task.id, prNumber: existingPr.providerPrNumber, from: task.state },
        "recovered a stuck task: a PR already existed, fast-forwarded to AWAITING_HUMAN_REVIEW",
      );
    } else {
      await stateMachine.forceRecover(
        task.id,
        "AWAITING_APPROVAL",
        `worker_restarted_from_${task.state}`,
      );
      deps.logger.warn(
        { taskId: task.id, from: task.state },
        "recovered a stuck task: no PR existed yet, restarting the Implementation Agent from scratch",
      );
    }
    return requireTask(deps, task.id);
  }

  return task;
}

/**
 * Drives one task forward exactly as far as its current state (after crash recovery) allows, then
 * returns — it does not loop across states in a single call beyond the hops that don't need a
 * human in between (CREATED -> planned -> awaiting approval). Safe to call repeatedly: this is
 * exactly what runs again after a crash (recoverIfStuck() always leaves the task in a state this
 * function knows how to drive from), after `POST /approvals/:id/decide` enqueues a resume, and on
 * a completely fresh task — the same dispatch either way.
 */
export async function runTask(deps: WorkerDependencies, taskId: string): Promise<void> {
  const stateMachine = new TaskStateMachine(deps.database);
  let task = await recoverIfStuck(deps, await requireTask(deps, taskId));
  const repository = await requireRepository(deps, task.repositoryId);

  if (task.state === "CREATED") {
    await runPlannerPhase(deps, task, repository);
    task = await requireTask(deps, task.id);
  }

  // Reaching AWAITING_APPROVAL is automatic (planning finished, one way or another) — creating the
  // plan_approval row a human decides on is what happens *at* that transition, not conditional on
  // autoApprovePlans. Only the *next* step (actually implementing) waits for a decision.
  if (task.state === "PLANNED") {
    await stateMachine.transition(task.id, "PLANNED", "AWAITING_APPROVAL");
    await deps.database.approvals.create({
      taskId: task.id,
      kind: "plan_approval",
      summary: await buildPlanApprovalSummary(deps, task),
    });
    task = await requireTask(deps, task.id);
  }

  if (task.state === "AWAITING_APPROVAL") {
    const planApproval = await findPlanApproval(deps, task.id);
    if (deps.autoApprovePlans || planApproval?.status === "approved") {
      await runImplementationPhase(deps, task, repository);
      return;
    }
    if (planApproval?.status === "denied") {
      await stateMachine.transition(task.id, "AWAITING_APPROVAL", "CANCELLED", {
        reason: "plan_denied",
      });
      deps.logger.info({ taskId: task.id }, "plan approval was denied — task cancelled");
      return;
    }
    deps.logger.info({ taskId: task.id }, "plan awaiting human approval — nothing more to do yet");
    return;
  }

  deps.logger.debug(
    { taskId: task.id, state: task.state },
    "no worker action needed for this state",
  );
}
