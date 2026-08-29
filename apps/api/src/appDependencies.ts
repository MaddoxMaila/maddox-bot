import type { Database } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import type { JobQueue } from "@maddox-bot/queue";
import type { Logger } from "@maddox-bot/shared";

export interface AppDependencies {
  database: Database;
  agentTriggerQueue: JobQueue<AgentTriggerJobPayload>;
  /** Nudges the worker to re-check a task after a human decides an approval — see
   * POST /approvals/:id/decide and apps/worker's README on why this is a separate queue from
   * agentTriggerQueue rather than a new AgentTriggerJobPayload variant. */
  taskResumeQueue: JobQueue<TaskResumeJobPayload>;
  githubWebhookSecret: string;
  jiraWebhookSecret: string;
  logger: Logger;
}
