import type { Database } from "@maddox-bot/database";
import type { TaskState } from "@maddox-bot/shared";
import { describe, expect, it, vi } from "vitest";
import { canTransition, resumeTarget, TaskStateMachine } from "./taskStateMachine.js";

describe("canTransition", () => {
  const happyPathEdges: Array<[TaskState, TaskState]> = [
    ["CREATED", "ANALYZING"],
    ["ANALYZING", "PLANNED"],
    ["PLANNED", "AWAITING_APPROVAL"],
    ["AWAITING_APPROVAL", "IMPLEMENTING"],
    ["IMPLEMENTING", "TESTING"],
    ["TESTING", "FIXING"],
    ["TESTING", "SELF_REVIEW"],
    ["FIXING", "TESTING"],
    ["SELF_REVIEW", "PR_CREATED"],
    ["PR_CREATED", "AWAITING_HUMAN_REVIEW"],
    ["AWAITING_HUMAN_REVIEW", "COMPLETED"],
  ];

  it.each(happyPathEdges)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("rejects skipping a stage", () => {
    expect(canTransition("CREATED", "PLANNED")).toBe(false);
    expect(canTransition("IMPLEMENTING", "PR_CREATED")).toBe(false);
  });

  it("rejects a self-transition", () => {
    expect(canTransition("TESTING", "TESTING")).toBe(false);
  });

  const terminalStates: TaskState[] = ["COMPLETED", "CANCELLED", "FAILED"];
  it.each(terminalStates)("rejects any transition out of the terminal state %s", (state) => {
    expect(canTransition(state, "ANALYZING")).toBe(false);
    expect(canTransition(state, "PAUSED")).toBe(false);
  });

  const exceptionalExits: TaskState[] = ["PAUSED", "CANCELLED", "FAILED", "BLOCKED"];
  it.each(exceptionalExits)("allows %s from any active (non-terminal) state", (exit) => {
    expect(canTransition("IMPLEMENTING", exit)).toBe(true);
    expect(canTransition("ANALYZING", exit)).toBe(true);
  });
});

describe("resumeTarget", () => {
  it("returns the recorded previousState when resuming from PAUSED", () => {
    expect(resumeTarget("PAUSED", "FIXING")).toBe("FIXING");
  });

  it("returns the recorded previousState when resuming from BLOCKED", () => {
    expect(resumeTarget("BLOCKED", "TESTING")).toBe("TESTING");
  });

  it("throws when the state is not resumable", () => {
    expect(() => resumeTarget("IMPLEMENTING", "ANALYZING")).toThrow(/only PAUSED or BLOCKED/);
  });

  it("throws when there is no previousState to resume to", () => {
    expect(() => resumeTarget("PAUSED", null)).toThrow(/no previousState/);
  });
});

function fakeDatabase(
  overrides: {
    state?: TaskState;
    previousState?: TaskState | null;
    found?: boolean;
  } = {},
): {
  database: Database;
  updateState: ReturnType<typeof vi.fn>;
  createEvent: ReturnType<typeof vi.fn>;
} {
  const state = overrides.state ?? "CREATED";
  const previousState = overrides.previousState ?? null;
  const found = overrides.found ?? true;

  const updateState = vi.fn().mockResolvedValue({ id: "task-1", state });
  const createEvent = vi.fn().mockResolvedValue({ id: "event-1" });

  const database = {
    agentTasks: {
      findById: vi.fn().mockResolvedValue(found ? { id: "task-1", state, previousState } : null),
      updateState,
    },
    taskEvents: {
      create: createEvent,
    },
  } as unknown as Database;

  return { database, updateState, createEvent };
}

describe("TaskStateMachine", () => {
  it("persists a legal transition and appends a state_changed event", async () => {
    const { database, updateState, createEvent } = fakeDatabase({ state: "CREATED" });
    const machine = new TaskStateMachine(database);

    await machine.transition("task-1", "CREATED", "ANALYZING");

    expect(updateState).toHaveBeenCalledWith("task-1", "ANALYZING");
    expect(createEvent).toHaveBeenCalledWith({
      taskId: "task-1",
      type: "state_changed",
      payload: { from: "CREATED", to: "ANALYZING" },
    });
  });

  it("includes extra metadata in the persisted event payload", async () => {
    const { database, createEvent } = fakeDatabase({ state: "ANALYZING" });
    const machine = new TaskStateMachine(database);

    await machine.transition("task-1", "ANALYZING", "PLANNED", { toolCallCount: 6 });

    expect(createEvent).toHaveBeenCalledWith({
      taskId: "task-1",
      type: "state_changed",
      payload: { from: "ANALYZING", to: "PLANNED", toolCallCount: 6 },
    });
  });

  it("throws and writes nothing when the task's actual state doesn't match `from`", async () => {
    const { database, updateState, createEvent } = fakeDatabase({ state: "PLANNED" });
    const machine = new TaskStateMachine(database);

    await expect(machine.transition("task-1", "CREATED", "ANALYZING")).rejects.toThrow(
      /expected task task-1 to be in state "CREATED"/i,
    );
    expect(updateState).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("throws and writes nothing for an illegal transition", async () => {
    const { database, updateState } = fakeDatabase({ state: "CREATED" });
    const machine = new TaskStateMachine(database);

    await expect(machine.transition("task-1", "CREATED", "PLANNED")).rejects.toThrow(/Illegal/);
    expect(updateState).not.toHaveBeenCalled();
  });

  it("throws when the task doesn't exist", async () => {
    const { database } = fakeDatabase({ found: false });
    const machine = new TaskStateMachine(database);

    await expect(machine.transition("task-1", "CREATED", "ANALYZING")).rejects.toThrow(
      /No such task/,
    );
  });

  it("resume() transitions back to the recorded previousState", async () => {
    const { database, updateState, createEvent } = fakeDatabase({
      state: "BLOCKED",
      previousState: "FIXING",
    });
    const machine = new TaskStateMachine(database);

    await machine.resume("task-1");

    expect(updateState).toHaveBeenCalledWith("task-1", "FIXING");
    expect(createEvent).toHaveBeenCalledWith({
      taskId: "task-1",
      type: "state_changed",
      payload: { from: "BLOCKED", to: "FIXING", resumed: true },
    });
  });

  it("forceRecover jumps straight to the target state, bypassing canTransition", async () => {
    const { database, updateState, createEvent } = fakeDatabase({ state: "TESTING" });
    const machine = new TaskStateMachine(database);

    // TESTING -> AWAITING_APPROVAL is not a legal graph edge, but forceRecover doesn't check.
    await machine.forceRecover("task-1", "AWAITING_APPROVAL", "worker_restarted");

    expect(updateState).toHaveBeenCalledWith("task-1", "AWAITING_APPROVAL");
    expect(createEvent).toHaveBeenCalledWith({
      taskId: "task-1",
      type: "state_changed",
      payload: {
        from: "TESTING",
        to: "AWAITING_APPROVAL",
        reason: "worker_restarted",
        forced: true,
      },
    });
  });

  it("forceRecover is a no-op when already in the target state", async () => {
    const { database, updateState, createEvent } = fakeDatabase({ state: "AWAITING_APPROVAL" });
    const machine = new TaskStateMachine(database);

    await machine.forceRecover("task-1", "AWAITING_APPROVAL", "worker_restarted");

    expect(updateState).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("forceRecover throws when the task doesn't exist", async () => {
    const { database } = fakeDatabase({ found: false });
    const machine = new TaskStateMachine(database);

    await expect(machine.forceRecover("task-1", "AWAITING_APPROVAL", "x")).rejects.toThrow(
      /No such task/,
    );
  });
});
