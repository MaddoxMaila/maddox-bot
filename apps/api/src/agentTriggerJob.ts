import type { NormalizedEventCore } from "@maddox-bot/events";

/**
 * What the API enqueues when a webhook is relevant. Deliberately not a full agent_task yet — that
 * requires resolving/creating a JiraIssue and running the Planner, which is agent-core/worker's
 * job (increments 12/14), not event ingestion's. The worker turns this into real task state once
 * it exists.
 */
export interface AgentTriggerJobPayload {
  source: "github" | "jira";
  repositoryId: string;
  eventType: string;
  externalRefs: NormalizedEventCore["externalRefs"];
  receivedEventId: string;
}
