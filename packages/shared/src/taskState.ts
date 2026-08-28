/**
 * The Phase 1 subset of the task state machine (approved plan, section 4). agent-core owns the
 * transition rules; this is just the shared vocabulary every package (database, api, worker,
 * vscode-extension) renders or persists without redefining its own copy.
 */
export const TASK_STATES = [
  "CREATED",
  "ANALYZING",
  "PLANNED",
  "AWAITING_APPROVAL",
  "IMPLEMENTING",
  "TESTING",
  "FIXING",
  "SELF_REVIEW",
  "PR_CREATED",
  "AWAITING_HUMAN_REVIEW",
  "COMPLETED",
  "PAUSED",
  "CANCELLED",
  "FAILED",
  "BLOCKED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}
