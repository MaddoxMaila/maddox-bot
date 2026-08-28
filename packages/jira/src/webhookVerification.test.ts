import { describe, expect, it } from "vitest";
import { verifyJiraWebhookToken } from "./webhookVerification.js";

const SECRET = "test-webhook-secret";

describe("verifyJiraWebhookToken", () => {
  it("accepts a token that matches the configured secret", () => {
    expect(verifyJiraWebhookToken(SECRET, SECRET)).toBe(true);
  });

  it("rejects a token that does not match", () => {
    expect(verifyJiraWebhookToken(SECRET, "wrong-token")).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    expect(verifyJiraWebhookToken(SECRET, "short")).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(verifyJiraWebhookToken(SECRET, undefined)).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(verifyJiraWebhookToken(SECRET, "")).toBe(false);
  });
});
