import type { Database } from "@maddox-bot/database";
import type { JobQueue } from "@maddox-bot/queue";
import type { Logger } from "@maddox-bot/shared";
import type { AgentTriggerJobPayload } from "./agentTriggerJob.js";

export interface AppDependencies {
  database: Database;
  agentTriggerQueue: JobQueue<AgentTriggerJobPayload>;
  githubWebhookSecret: string;
  jiraWebhookSecret: string;
  logger: Logger;
}
