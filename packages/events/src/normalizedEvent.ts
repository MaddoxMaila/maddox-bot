export interface NormalizedEventCore {
  source: "github" | "jira";
  sourceEventId: string;
  eventType: string;
  /** hash(source + sourceEventId); also doubles as the BullMQ jobId for enqueue-time dedupe. */
  dedupeKey: string;
  occurredAt: string;
  externalRefs: {
    repoFullName?: string;
    prNumber?: number;
    issueKey?: string;
    branch?: string;
  };
  /** Normalized minimal fields agent-core needs — not the full raw webhook body. */
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface RelevanceResult {
  isRelevant: boolean;
  reason: string;
}
