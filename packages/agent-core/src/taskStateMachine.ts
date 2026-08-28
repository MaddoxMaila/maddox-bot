import type { Database } from "@maddox-bot/database";
import { type TaskState } from "@maddox-bot/shared";

/**
 * The happy-path graph (approved plan, section 4). Deliberately excludes PAUSED/CANCELLED/FAILED/
 * BLOCKED — those are reachable from any non-terminal state (see ALWAYS_FROM_ACTIVE below) rather
 * than repeated on every row here.
 */
const HAPPY_PATH: Record<TaskState, TaskState[]> = {
  CREATED: ["ANALYZING"],
  ANALYZING: ["PLANNED"],
  PLANNED: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["IMPLEMENTING"],
  IMPLEMENTING: ["TESTING"],
  TESTING: ["FIXING", "SELF_REVIEW"],
  FIXING: ["TESTING"],
  SELF_REVIEW: ["PR_CREATED"],
  PR_CREATED: ["AWAITING_HUMAN_REVIEW"],
  AWAITING_HUMAN_REVIEW: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
  BLOCKED: [],
  PAUSED: [],
};

const TERMINAL_STATES = new Set<TaskState>(["COMPLETED", "CANCELLED", "FAILED"]);

// Exceptional exits available from any non-terminal state — a task can always be paused, cancelled,
// failed, or blocked, regardless of which stage it's in. Resuming from PAUSED/BLOCKED is not a fixed
// graph edge (the destination is per-row, via `previousState`) — see resumeTarget() below.
const ALWAYS_FROM_ACTIVE: readonly TaskState[] = ["PAUSED", "CANCELLED", "FAILED", "BLOCKED"];

export function canTransition(from: TaskState, to: TaskState): boolean {
  if (from === to) {
    return false;
  }
  if (TERMINAL_STATES.has(from)) {
    return false;
  }
  if (ALWAYS_FROM_ACTIVE.includes(to)) {
    return true;
  }
  return HAPPY_PATH[from].includes(to);
}

export function resumeTarget(state: TaskState, previousState: TaskState | null): TaskState {
  if (state !== "PAUSED" && state !== "BLOCKED") {
    throw new Error(`Cannot resume a task from "${state}" — only PAUSED or BLOCKED can resume`);
  }
  if (previousState === null) {
    throw new Error(`Cannot resume: no previousState recorded for this task`);
  }
  return previousState;
}

/**
 * Persists a validated transition: updates `agent_tasks.state` and appends a `task_events` row in
 * the same call, so every state change in the audit trail is guaranteed to correspond to a real,
 * legal transition — never written separately or out of sync with each other.
 */
export class TaskStateMachine {
  constructor(private readonly database: Database) {}

  async transition(
    taskId: string,
    from: TaskState,
    to: TaskState,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const current = await this.requireCurrentState(taskId, from);
    if (!canTransition(current, to)) {
      throw new Error(`Illegal task state transition: ${from} -> ${to}`);
    }
    await this.persist(taskId, from, to, metadata);
  }

  /**
   * Resuming from PAUSED/BLOCKED is not a fixed graph edge — the destination is whatever
   * `previousState` recorded — so this validates via resumeTarget() instead of canTransition(),
   * then persists exactly like a normal transition.
   */
  async resume(taskId: string): Promise<void> {
    const current = await this.database.agentTasks.findById(taskId);
    if (!current) {
      throw new Error(`No such task: ${taskId}`);
    }
    const target = resumeTarget(current.state, current.previousState);
    await this.persist(taskId, current.state, target, { resumed: true });
  }

  private async requireCurrentState(taskId: string, expected: TaskState): Promise<TaskState> {
    const current = await this.database.agentTasks.findById(taskId);
    if (!current) {
      throw new Error(`No such task: ${taskId}`);
    }
    if (current.state !== expected) {
      throw new Error(
        `Expected task ${taskId} to be in state "${expected}" but it is "${current.state}"`,
      );
    }
    return current.state;
  }

  private async persist(
    taskId: string,
    from: TaskState,
    to: TaskState,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.database.agentTasks.updateState(taskId, to);
    await this.database.taskEvents.create({
      taskId,
      type: "state_changed",
      payload: { from, to, ...metadata },
    });
  }
}
