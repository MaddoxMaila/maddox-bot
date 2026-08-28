export type PermissionTier = "safe" | "approval_required" | "human_only";

export interface PermissionCheckInput {
  toolName: string;
  input: unknown;
  /**
   * Populated by the caller (agent-tools, once it exists) for a git.commit that's about to
   * remove significant content — this package classifies tool calls, it doesn't compute diffs.
   */
  linesDeleted?: number;
}

export interface PermissionDecision {
  tier: PermissionTier;
  reason: string;
}
