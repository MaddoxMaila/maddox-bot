import { computeDedupeKey } from "./dedupeKey.js";
import type { NormalizedEventCore, RelevanceResult } from "./normalizedEvent.js";

export interface GitHubWebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    head: { ref: string };
    merged?: boolean;
  };
  repository: { full_name: string };
}

export function normalizeGitHubEvent(
  eventType: string,
  deliveryId: string,
  payload: GitHubWebhookPayload,
): NormalizedEventCore {
  const fullEventType = payload.action
    ? `github.${eventType}.${payload.action}`
    : `github.${eventType}`;
  return {
    source: "github",
    sourceEventId: deliveryId,
    eventType: fullEventType,
    dedupeKey: computeDedupeKey("github", deliveryId),
    // GitHub webhook payloads don't carry one consistent top-level timestamp field across event
    // types; receipt time is an accepted Phase 1 simplification (see relevance's own note above).
    occurredAt: new Date().toISOString(),
    externalRefs: {
      repoFullName: payload.repository.full_name,
      ...(payload.pull_request !== undefined && {
        prNumber: payload.pull_request.number,
        branch: payload.pull_request.head.ref,
      }),
    },
    payload: payload.action !== undefined ? { action: payload.action } : {},
    rawPayload: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Phase 1 only reacts to events on PRs/branches this platform itself created — closing our own
 * loop (e.g. merged -> COMPLETED) — not spawning new work from arbitrary inbound PR/CI events.
 * That's the PR-review and CI-failure workflows, explicitly Phase 2+. Whether a PR is "ours" is a
 * database lookup, so the caller resolves it and passes the answer in here.
 */
export function evaluateGitHubRelevance(context: {
  isTrackedPullRequest: boolean;
}): RelevanceResult {
  if (!context.isTrackedPullRequest) {
    return { isRelevant: false, reason: "not_a_platform_created_pull_request" };
  }
  return { isRelevant: true, reason: "event_on_platform_created_pull_request" };
}
