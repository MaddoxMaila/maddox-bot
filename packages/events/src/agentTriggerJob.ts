import type { NormalizedEventCore } from "./normalizedEvent.js";

/**
 * What the API enqueues when a webhook is relevant, and what the worker consumes. Deliberately not
 * a full agent_task yet — that requires resolving/creating a JiraIssue and running the Planner,
 * which is the worker's job, not event ingestion's. Lives here (not in either app) because the
 * producer (apps/api) and the consumer (apps/worker) must agree on the exact shape, and apps don't
 * depend on each other.
 */
export interface AgentTriggerJobPayload {
  source: "github" | "jira";
  repositoryId: string;
  eventType: string;
  externalRefs: NormalizedEventCore["externalRefs"];
  receivedEventId: string;
}
