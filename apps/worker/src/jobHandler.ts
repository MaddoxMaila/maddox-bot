import type { AgentTriggerJobPayload } from "@maddox-bot/events";
import { runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

async function handleJiraTrigger(
  deps: WorkerDependencies,
  payload: AgentTriggerJobPayload,
): Promise<void> {
  const { issueKey } = payload.externalRefs;
  if (issueKey === undefined) {
    deps.logger.warn({ payload }, "jira trigger job has no issueKey — skipping");
    return;
  }

  const repository = await deps.database.repositories.findById(payload.repositoryId);
  if (!repository) {
    deps.logger.warn(
      { repositoryId: payload.repositoryId },
      "jira trigger job references an unknown repository — skipping",
    );
    return;
  }

  // A BullMQ job whose handler throws partway through retries the *whole* handler (the queue's
  // own attempts: 3) — without this check, a retry after e.g. a transient Jira API error would
  // create a second AgentTask for the same webhook delivery. Reuse whichever task this event
  // already produced, if any, rather than creating a duplicate.
  const existingTask = await deps.database.agentTasks.findByReceivedEventId(
    payload.receivedEventId,
  );
  if (existingTask) {
    deps.logger.info(
      { taskId: existingTask.id, receivedEventId: payload.receivedEventId },
      "jira trigger job already produced a task on a prior attempt — resuming it instead of creating another",
    );
    await runTask(deps, existingTask.id);
    return;
  }

  const issue = await deps.jiraClient.getIssue(issueKey);
  const jiraIssue = await deps.database.jiraIssues.upsertByIssueKey({
    repositoryId: repository.id,
    issueKey: issue.key,
    summary: issue.summary,
    description: issue.description,
    status: issue.status,
    ...(issue.assignee !== null && { assignee: issue.assignee }),
    labels: issue.labels,
    raw: issue as unknown as Record<string, unknown>,
  });

  const task = await deps.database.agentTasks.create({
    organizationId: repository.organizationId,
    repositoryId: repository.id,
    jiraIssueId: jiraIssue.id,
    trigger: {
      kind: "jira_event",
      eventType: payload.eventType,
      receivedEventId: payload.receivedEventId,
    },
    bounds: {},
  });

  await runTask(deps, task.id);
}

/**
 * GitHub-sourced jobs (closing the loop on a platform-created PR, e.g. merged -> COMPLETED) aren't
 * wired yet — the relevance check already guarantees these only arrive for PRs this platform
 * created, but doing anything useful with the merge event needs the normalized payload's `merged`
 * flag threaded through AgentTriggerJobPayload, which nothing produces yet. Logged and skipped
 * rather than half-implemented; the actual close-the-loop behavior is separate, smaller follow-up
 * work, not something this increment's worker-resilience scenario depends on.
 */
async function handleGitHubTrigger(
  deps: WorkerDependencies,
  payload: AgentTriggerJobPayload,
): Promise<void> {
  deps.logger.info({ payload }, "github trigger jobs aren't handled yet — skipping");
}

export async function handleAgentTriggerJob(
  deps: WorkerDependencies,
  payload: AgentTriggerJobPayload,
): Promise<void> {
  // "direct" (the VS Code extension's explicit "implement <ISSUE-KEY>" command) is handled
  // identically to a Jira webhook trigger — both resolve to "fetch this issue key and implement
  // it," just via a different front door.
  if (payload.source === "jira" || payload.source === "direct") {
    await handleJiraTrigger(deps, payload);
  } else {
    await handleGitHubTrigger(deps, payload);
  }
}
