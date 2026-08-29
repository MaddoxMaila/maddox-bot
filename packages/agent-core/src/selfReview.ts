import { z } from "zod";

/**
 * Phase 1's self-review is deliberately lightweight — a summary plus any concerns worth a human's
 * attention — not the full independent-context adversarial review of spec §35. Nothing here blocks
 * PR creation on what it finds; it's recorded in the PR body for the human reviewer.
 */
export const selfReviewSchema = z.object({
  summary: z.string().min(1),
  concerns: z.array(z.string()),
});

export type SelfReview = z.infer<typeof selfReviewSchema>;
