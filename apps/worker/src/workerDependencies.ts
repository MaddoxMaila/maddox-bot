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
   * Phase 1 has no plan-approval UI yet (the API's approval endpoints are increment 15) — with
   * this on, the worker approves every plan itself right after PlannerRunner produces one, so the
   * Jira -> implementation -> PR pipeline can be exercised end-to-end today. The state machine
   * still records a real AWAITING_APPROVAL -> IMPLEMENTING transition; only the *decision* is
   * automated. Flip off once a real approval endpoint exists — nothing else about the pipeline
   * needs to change.
   */
  autoApprovePlans: boolean;
  logger: Logger;
}
