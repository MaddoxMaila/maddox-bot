import { computeDedupeKey } from "./dedupeKey.js";
import type { NormalizedEventCore, RelevanceResult } from "./normalizedEvent.js";

export interface JiraWebhookPayload {
  webhookEvent: string;
  timestamp: number;
  issue: {
    key: string;
    fields: {
      status: { name: string };
      labels: string[];
      assignee: { accountId: string } | null;
    };
  };
  changelog?: {
    items: Array<{ field: string; fromString: string | null; toString: string | null }>;
  };
}

export interface JiraTriggerConfig {
  triggerStatus?: string;
  triggerLabel?: string;
  aiAssigneeAccountId?: string;
}

const DEFAULT_TRIGGER_STATUS = "AI READY";
const DEFAULT_TRIGGER_LABEL = "ai-agent";

export function normalizeJiraEvent(payload: JiraWebhookPayload): NormalizedEventCore {
  // Jira webhooks carry no delivery id analogous to GitHub's X-GitHub-Delivery header; this pair
  // is stable for a given issue+moment and unique enough for Phase 1's single-webhook-per-issue-
  // change volume.
  const sourceEventId = `${payload.issue.key}-${payload.timestamp}`;
  return {
    source: "jira",
    sourceEventId,
    eventType: payload.webhookEvent,
    dedupeKey: computeDedupeKey("jira", sourceEventId),
    occurredAt: new Date(payload.timestamp).toISOString(),
    externalRefs: { issueKey: payload.issue.key },
    payload: {
      issueKey: payload.issue.key,
      status: payload.issue.fields.status.name,
      labels: payload.issue.fields.labels,
    },
    rawPayload: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Deliberately keyed off the changelog (what just changed), not current issue state: checking
 * current state alone would re-trigger on every subsequent edit to an issue that's already past
 * its trigger condition, which is exactly the "don't spawn duplicate work" failure the plan warns
 * about. Fires once, at the moment of transition.
 */
export function evaluateJiraRelevance(
  payload: JiraWebhookPayload,
  triggerConfig: JiraTriggerConfig,
): RelevanceResult {
  const triggerStatus = triggerConfig.triggerStatus ?? DEFAULT_TRIGGER_STATUS;
  const triggerLabel = triggerConfig.triggerLabel ?? DEFAULT_TRIGGER_LABEL;

  if (payload.webhookEvent === "jira:issue_created") {
    if (payload.issue.fields.status.name === triggerStatus) {
      return { isRelevant: true, reason: "created_directly_in_trigger_status" };
    }
    return { isRelevant: false, reason: "not_in_trigger_status" };
  }

  const changelogItems = payload.changelog?.items ?? [];

  const statusTransition = changelogItems.find((item) => item.field === "status");
  if (statusTransition && statusTransition.toString === triggerStatus) {
    return { isRelevant: true, reason: "status_transitioned_to_trigger" };
  }

  const labelChange = changelogItems.find((item) => item.field === "labels");
  if (labelChange) {
    const before = (labelChange.fromString ?? "").split(" ").filter(Boolean);
    const after = (labelChange.toString ?? "").split(" ").filter(Boolean);
    if (after.includes(triggerLabel) && !before.includes(triggerLabel)) {
      return { isRelevant: true, reason: "trigger_label_added" };
    }
  }

  const assigneeChange = changelogItems.find((item) => item.field === "assignee");
  if (
    triggerConfig.aiAssigneeAccountId !== undefined &&
    assigneeChange &&
    payload.issue.fields.assignee?.accountId === triggerConfig.aiAssigneeAccountId
  ) {
    return { isRelevant: true, reason: "assigned_to_ai_account" };
  }

  return { isRelevant: false, reason: "no_matching_trigger_condition" };
}
