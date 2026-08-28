import { describe, expect, it } from "vitest";
import {
  evaluateJiraRelevance,
  normalizeJiraEvent,
  type JiraWebhookPayload,
} from "./jiraEvents.js";

function basePayload(overrides: Partial<JiraWebhookPayload> = {}): JiraWebhookPayload {
  return {
    webhookEvent: "jira:issue_updated",
    timestamp: 1735689600000,
    issue: {
      key: "PROJ-481",
      fields: { status: { name: "AI READY" }, labels: [], assignee: null },
    },
    ...overrides,
  };
}

describe("normalizeJiraEvent", () => {
  it("synthesizes a stable sourceEventId from issue key and timestamp", () => {
    const payload = basePayload();
    const event = normalizeJiraEvent(payload);
    expect(event.sourceEventId).toBe("PROJ-481-1735689600000");
    expect(event.source).toBe("jira");
    expect(event.externalRefs).toEqual({ issueKey: "PROJ-481" });
  });

  it("produces the same dedupeKey for the same payload", () => {
    const payload = basePayload();
    expect(normalizeJiraEvent(payload).dedupeKey).toBe(normalizeJiraEvent(payload).dedupeKey);
  });
});

describe("evaluateJiraRelevance", () => {
  it("is relevant when an issue is created directly in the trigger status", () => {
    const payload = basePayload({ webhookEvent: "jira:issue_created" });
    expect(evaluateJiraRelevance(payload, {})).toEqual({
      isRelevant: true,
      reason: "created_directly_in_trigger_status",
    });
  });

  it("is not relevant when an issue is created outside the trigger status", () => {
    const payload = basePayload({
      webhookEvent: "jira:issue_created",
      issue: { key: "PROJ-1", fields: { status: { name: "BACKLOG" }, labels: [], assignee: null } },
    });
    expect(evaluateJiraRelevance(payload, {}).isRelevant).toBe(false);
  });

  it("is relevant when status transitions into the trigger status", () => {
    const payload = basePayload({
      changelog: { items: [{ field: "status", fromString: "BACKLOG", toString: "AI READY" }] },
    });
    expect(evaluateJiraRelevance(payload, {})).toEqual({
      isRelevant: true,
      reason: "status_transitioned_to_trigger",
    });
  });

  it("is not relevant when status transitions to something other than the trigger status", () => {
    const payload = basePayload({
      changelog: { items: [{ field: "status", fromString: "AI READY", toString: "HUMAN REVIEW" }] },
    });
    expect(evaluateJiraRelevance(payload, {}).isRelevant).toBe(false);
  });

  it("respects a custom triggerStatus", () => {
    const payload = basePayload({
      changelog: { items: [{ field: "status", fromString: "BACKLOG", toString: "READY FOR BOT" }] },
    });
    expect(evaluateJiraRelevance(payload, { triggerStatus: "READY FOR BOT" }).isRelevant).toBe(
      true,
    );
  });

  it("is relevant when the trigger label is freshly added", () => {
    const payload = basePayload({
      changelog: { items: [{ field: "labels", fromString: "", toString: "ai-agent" }] },
    });
    expect(evaluateJiraRelevance(payload, {})).toEqual({
      isRelevant: true,
      reason: "trigger_label_added",
    });
  });

  it("is not relevant when the trigger label was already present before this change", () => {
    const payload = basePayload({
      changelog: {
        items: [{ field: "labels", fromString: "ai-agent urgent", toString: "ai-agent" }],
      },
    });
    expect(evaluateJiraRelevance(payload, {}).isRelevant).toBe(false);
  });

  it("is relevant when assigned to the configured AI account", () => {
    const payload = basePayload({
      issue: {
        key: "PROJ-481",
        fields: { status: { name: "BACKLOG" }, labels: [], assignee: { accountId: "ai-bot-id" } },
      },
      changelog: { items: [{ field: "assignee", fromString: null, toString: "AI Bot" }] },
    });
    expect(evaluateJiraRelevance(payload, { aiAssigneeAccountId: "ai-bot-id" })).toEqual({
      isRelevant: true,
      reason: "assigned_to_ai_account",
    });
  });

  it("is not relevant when no aiAssigneeAccountId is configured, even if assignee changed", () => {
    const payload = basePayload({
      issue: {
        key: "PROJ-481",
        fields: { status: { name: "BACKLOG" }, labels: [], assignee: { accountId: "ai-bot-id" } },
      },
      changelog: { items: [{ field: "assignee", fromString: null, toString: "AI Bot" }] },
    });
    expect(evaluateJiraRelevance(payload, {}).isRelevant).toBe(false);
  });

  it("is not relevant when nothing in the changelog matches a trigger condition", () => {
    const payload = basePayload({
      changelog: { items: [{ field: "description", fromString: "old", toString: "new" }] },
    });
    expect(evaluateJiraRelevance(payload, {})).toEqual({
      isRelevant: false,
      reason: "no_matching_trigger_condition",
    });
  });

  it("is not relevant when there is no changelog at all", () => {
    expect(evaluateJiraRelevance(basePayload(), {}).isRelevant).toBe(false);
  });
});
