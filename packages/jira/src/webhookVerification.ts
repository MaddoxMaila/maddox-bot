import { timingSafeEqual } from "node:crypto";

/**
 * Jira Cloud's generic webhook feature has no built-in request-signing scheme (unlike GitHub's
 * HMAC header) — the accepted pattern is a shared-secret token configured into the webhook URL
 * itself and checked on receipt. Constant-time comparison avoids a timing side-channel on the
 * secret, same principle as the GitHub HMAC check.
 */
export function verifyJiraWebhookToken(
  configuredSecret: string,
  providedToken: string | undefined,
): boolean {
  if (!providedToken) {
    return false;
  }
  const configuredBuffer = Buffer.from(configuredSecret);
  const providedBuffer = Buffer.from(providedToken);
  if (configuredBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(configuredBuffer, providedBuffer);
}
