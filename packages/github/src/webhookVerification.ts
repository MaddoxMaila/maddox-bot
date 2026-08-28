import { verify } from "@octokit/webhooks-methods";

/**
 * Verifies a GitHub webhook's HMAC-SHA256 signature. Must be checked against the *raw* request
 * body — verifying a re-serialized/re-parsed JSON body can silently pass or fail depending on key
 * ordering and whitespace, defeating the point of the check.
 */
export async function verifyGitHubWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader) {
    return false;
  }
  return verify(secret, rawBody, signatureHeader);
}
