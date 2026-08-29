import type { Database } from "@maddox-bot/database";
import type { AgentTriggerJobPayload } from "@maddox-bot/events";
import type { GitHubClient } from "@maddox-bot/github";
import type { JiraClient } from "@maddox-bot/jira";
import type { LLMProvider, ModelRouter } from "@maddox-bot/llm";
import type { JobQueue } from "@maddox-bot/queue";
import type { Logger } from "@maddox-bot/shared";

export interface GitIdentityConfig {
  name: string;
  email: string;
}

export interface WorkerDependencies {
  database: Database;
  agentTriggerQueue: JobQueue<AgentTriggerJobPayload>;
  llm: LLMProvider;
  modelRouter: ModelRouter;
  githubToken: string;
  githubClient: GitHubClient;
  jiraClient: JiraClient;
  sandboxImage: string;
  gitIdentity: GitIdentityConfig;
  /**
   * With this on, the worker approves every plan itself the moment a task reaches
   * AWAITING_APPROVAL, instead of waiting for a real decision via `POST /approvals/:id/decide`
   * (apps/api). A real `plan_approval` row is still created either way — this only skips waiting
   * for it to be decided. Useful for exercising the Jira -> implementation -> PR pipeline without
   * a human in the loop (e.g. local development); off by default in a real deployment once a human
   * is actually expected to review plans.
   */
  autoApprovePlans: boolean;
  logger: Logger;
}
