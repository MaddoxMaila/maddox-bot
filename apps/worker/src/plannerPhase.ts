import { PlannerRunner } from "@maddox-bot/agent-core";
import type { AgentTaskRecord, RepositoryRecord } from "@maddox-bot/database";
import { createId } from "@maddox-bot/shared";
import { denyWithoutHuman } from "./denyWithoutHuman.js";
import { buildPlannerToolRegistry } from "./toolRegistryFactory.js";
import type { WorkerDependencies } from "./workerDependencies.js";
import { createTaskWorkspace } from "./workspace.js";

/** Drives a task from CREATED to PLANNED/BLOCKED. A fresh clone + sandbox per call — the Planner
 * never touches anything outside Postgres, so there is no state here worth persisting or
 * resuming; a crash mid-ANALYZING just restarts this from scratch (see taskRunner.ts). */
export async function runPlannerPhase(
  deps: WorkerDependencies,
  task: AgentTaskRecord,
  repository: RepositoryRecord,
): Promise<void> {
  if (!task.jiraIssueId) {
    throw new Error(`Task ${task.id} has no linked Jira issue — the Planner needs one for context`);
  }
  const jiraIssue = await deps.database.jiraIssues.findById(task.jiraIssueId);
  if (!jiraIssue) {
    throw new Error(
      `Task ${task.id} references a Jira issue that no longer exists: ${task.jiraIssueId}`,
    );
  }

  const workspace = await createTaskWorkspace({
    cloneUrl: repository.cloneUrl,
    githubToken: deps.githubToken,
    gitIdentity: deps.gitIdentity,
    sandboxImage: deps.sandboxImage,
  });
  try {
    const toolRegistry = buildPlannerToolRegistry(
      workspace.gitClient,
      workspace.directory,
      deps.githubClient,
      deps.jiraClient,
    );
    const runner = new PlannerRunner({
      llm: deps.llm,
      model: deps.modelRouter.modelFor("planning"),
      toolRegistry,
      database: deps.database,
      requestApproval: denyWithoutHuman(deps.logger),
    });

    await runner.run({
      taskId: task.id,
      workspaceId: createId(),
      context: {
        jiraIssue: {
          key: jiraIssue.issueKey,
          summary: jiraIssue.summary,
          description: jiraIssue.description ?? "",
          status: jiraIssue.status,
        },
        repository: {
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        },
      },
    });
  } finally {
    await workspace.destroy();
  }
}
