import type { Logger } from "@maddox-bot/shared";

/** Phase 1 has no plan-approval UI (increment 15's job) and no way to surface an approval-required
 * tool call to a human either — if anything unexpectedly needs approval, the safe default is to
 * deny it and log loudly, not to auto-approve an escalation nobody reviewed. */
export function denyWithoutHuman(
  logger: Logger,
): (summary: string) => Promise<"approved" | "denied"> {
  return async (summary: string) => {
    logger.warn(
      { summary },
      "a tool requested approval but no human-approval mechanism is wired yet (increment 15) — denying",
    );
    return "denied";
  };
}
