import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "./webhookVerification.js";

const SECRET = "test-webhook-secret";
const PAYLOAD = JSON.stringify({ action: "opened", number: 42 });

function sign(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a correctly signed payload", async () => {
    const signature = sign(SECRET, PAYLOAD);
    await expect(verifyGitHubWebhookSignature(SECRET, PAYLOAD, signature)).resolves.toBe(true);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const signature = sign("a-different-secret", PAYLOAD);
    await expect(verifyGitHubWebhookSignature(SECRET, PAYLOAD, signature)).resolves.toBe(false);
  });

  it("rejects a tampered payload (valid signature, different body)", async () => {
    const signature = sign(SECRET, PAYLOAD);
    const tampered = JSON.stringify({ action: "opened", number: 43 });
    await expect(verifyGitHubWebhookSignature(SECRET, tampered, signature)).resolves.toBe(false);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyGitHubWebhookSignature(SECRET, PAYLOAD, undefined)).resolves.toBe(false);
  });

  it("rejects a malformed signature header", async () => {
    await expect(
      verifyGitHubWebhookSignature(SECRET, PAYLOAD, "not-a-real-signature"),
    ).resolves.toBe(false);
  });
});
