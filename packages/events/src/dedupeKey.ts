import { createHash } from "node:crypto";

export function computeDedupeKey(source: "github" | "jira", sourceEventId: string): string {
  return createHash("sha256").update(`${source}:${sourceEventId}`).digest("hex");
}
