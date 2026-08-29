import { implementationPlanSchema, ImplementationAgentRunner } from "@maddox-bot/agent-core";
import type { AgentTaskRecord, RepositoryRecord } from "@maddox-bot/database";
import { createId } from "@maddox-bot/shared";
import { buildBranchName } from "./branchName.js";
import { denyWithoutHuman } from "./denyWithoutHuman.js";
import { buildImplementationToolRegistry } from "./toolRegistryFactory.js";
import type { WorkerDependencies } from "./workerDependencies.js";
import { createTaskWorkspace } from "./workspace.js";

/** Drives a task from AWAITING_APPROVAL through to AWAITING_HUMAN_REVIEW/BLOCKED. Always starts
 * from a fresh clone + sandbox — see taskRunner.ts's recovery logic for why a crash mid-flight
 * restarts this whole phase rather than trying to resume a specific sub-stage. */
export async function runImplementationPhase(
  deps: WorkerDependencies,
  task: AgentTaskRecord,
  repository: RepositoryRecord,
): Promise<void> {
  if (!task.jiraIssueId) {
    throw new Error(`Task ${task.id} has no linked Jira issue`);
  }
  const jiraIssue = await deps.database.jiraIssues.findById(task.jiraIssueId);
  if (!jiraIssue) {
    throw new Error(
      `Task ${task.id} references a Jira issue that no longer exists: ${task.jiraIssueId}`,
    );
  }
  const plan = implementationPlanSchema.parse(task.plan);

  const workspace = await createTaskWorkspace({
    cloneUrl: repository.cloneUrl,
    githubToken: deps.githubToken,
    gitIdentity: deps.gitIdentity,
    sandboxImage: deps.sandboxImage,
  });
  try {
    const toolRegistry = buildImplementationToolRegistry(
      workspace.gitClient,
      workspace.directory,
      workspace.sandbox,
      deps.githubClient,
      deps.jiraClient,
    );
    const runner = new ImplementationAgentRunner({
      llm: deps.llm,
      model: deps.modelRouter.modelFor("implementation"),
      toolRegistry,
      database: deps.database,
      requestApproval: denyWithoutHuman(deps.logger),
    });

    await runner.run({
      taskId: task.id,
      workspaceId: createId(),
      plan,
      jiraIssue: { key: jiraIssue.issueKey, summary: jiraIssue.summary },
      repository: { id: repository.id, owner: repository.owner, name: repository.name },
      baseBranch: repository.defaultBranch,
      branchName: buildBranchName(
        repository.branchNamingTemplate,
        jiraIssue.issueKey,
        plan.summary,
      ),
    });
  } finally {
    await workspace.destroy();
  }
}
