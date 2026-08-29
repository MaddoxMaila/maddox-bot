import type { Database } from "@maddox-bot/database";
import type { AgentTriggerJobPayload } from "@maddox-bot/events";
import type { JobQueue } from "@maddox-bot/queue";
import type { Logger } from "@maddox-bot/shared";

export interface AppDependencies {
  database: Database;
  agentTriggerQueue: JobQueue<AgentTriggerJobPayload>;
  githubWebhookSecret: string;
  jiraWebhookSecret: string;
  logger: Logger;
}
