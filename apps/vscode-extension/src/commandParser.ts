/**
 * Phase 1's chat understands a small fixed command set (plan section "Assumptions carried without
 * blocking") via pattern matching, not open-ended conversational reference resolution — "fix that"
 * is out of scope until a later phase.
 */
export type ChatCommand =
  | { type: "implement"; issueKey: string }
  | { type: "cancel" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "status" }
  | { type: "diff" }
  | { type: "help" }
  | { type: "unknown"; raw: string };

const IMPLEMENT_PATTERN = /^implement\s+([A-Za-z][A-Za-z0-9]*-\d+)$/i;

export function parseCommand(input: string): ChatCommand {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const implementMatch = IMPLEMENT_PATTERN.exec(trimmed);
  if (implementMatch?.[1] !== undefined) {
    return { type: "implement", issueKey: implementMatch[1].toUpperCase() };
  }

  switch (lower) {
    case "cancel":
      return { type: "cancel" };
    case "pause":
      return { type: "pause" };
    case "resume":
    case "continue":
      return { type: "resume" };
    case "status":
    case "show status":
      return { type: "status" };
    case "diff":
    case "show diff":
      return { type: "diff" };
    case "help":
      return { type: "help" };
    default:
      return { type: "unknown", raw: trimmed };
  }
}
