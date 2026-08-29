import type { NormalizedEventCore } from "./normalizedEvent.js";

/**
 * What the API enqueues when a webhook is relevant, and what the worker consumes. Deliberately not
 * a full agent_task yet — that requires resolving/creating a JiraIssue and running the Planner,
 * which is the worker's job, not event ingestion's. Lives here (not in either app) because the
 * producer (apps/api) and the consumer (apps/worker) must agree on the exact shape, and apps don't
 * depend on each other.
 *
 * `source: "direct"` is the VS Code extension's explicit "implement <ISSUE-KEY>" command (plan
 * section 3's "direct trigger") — apps/api's `POST /tasks` enqueues one of these instead of going
 * through webhook verification/relevance, but it converges on the exact same payload shape and the
 * exact same worker-side handling as a `jira`-sourced one (see apps/worker's jobHandler.ts): both
 * ultimately just mean "fetch this issue key and implement it."
 */
export interface AgentTriggerJobPayload {
  source: "github" | "jira" | "direct";
  repositoryId: string;
  eventType: string;
  externalRefs: NormalizedEventCore["externalRefs"];
  receivedEventId: string;
}
