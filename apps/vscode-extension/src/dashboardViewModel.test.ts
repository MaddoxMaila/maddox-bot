import { describe, expect, it } from "vitest";
import type { ApprovalDto, TaskDto, TaskEventDto } from "./apiClient.js";
import {
  applyPendingApprovals,
  applyStreamUpdate,
  applyTaskList,
  createDashboardState,
  selectTask,
} from "./dashboardViewModel.js";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    repositoryId: "repo-1",
    state: "CREATED",
    jiraIssueId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function event(id: string): TaskEventDto {
  return { id, type: "state_changed", payload: {}, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("applyTaskList", () => {
  it("projects each task down to id/state/createdAt", () => {
    const state = applyTaskList(createDashboardState(), [task({ id: "t1" }), task({ id: "t2" })]);
    expect(state.tasks).toEqual([
      { id: "t1", state: "CREATED", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "t2", state: "CREATED", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("applyPendingApprovals", () => {
  it("replaces the pending approvals list", () => {
    const approvals: ApprovalDto[] = [
      {
        id: "a1",
        taskId: "t1",
        kind: "plan_approval",
        summary: "x",
        status: "pending",
        createdAt: "",
      },
    ];
    const state = applyPendingApprovals(createDashboardState(), approvals);
    expect(state.pendingApprovals).toEqual(approvals);
  });
});

describe("selectTask", () => {
  it("sets the selected task and clears any prior event log", () => {
    let state = createDashboardState();
    state = applyStreamUpdate(selectTask(state, "t1"), "t1", {
      type: "update",
      state: "CREATED",
      newEvents: [event("e1")],
    });
    expect(state.selectedTaskEvents).toHaveLength(1);

    state = selectTask(state, "t2");

    expect(state.selectedTaskId).toBe("t2");
    expect(state.selectedTaskEvents).toEqual([]);
  });
});

describe("applyStreamUpdate", () => {
  it("appends new events and updates that task's state in the list", () => {
    let state = applyTaskList(createDashboardState(), [task({ id: "t1", state: "CREATED" })]);
    state = selectTask(state, "t1");

    state = applyStreamUpdate(state, "t1", {
      type: "update",
      state: "ANALYZING",
      newEvents: [event("e1"), event("e2")],
    });

    expect(state.selectedTaskEvents.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(state.tasks[0]).toMatchObject({ id: "t1", state: "ANALYZING" });
  });

  it("accumulates events across multiple updates rather than replacing them", () => {
    let state = selectTask(createDashboardState(), "t1");
    state = applyStreamUpdate(state, "t1", {
      type: "update",
      state: "CREATED",
      newEvents: [event("e1")],
    });
    state = applyStreamUpdate(state, "t1", {
      type: "update",
      state: "ANALYZING",
      newEvents: [event("e2")],
    });

    expect(state.selectedTaskEvents.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("ignores an update from a task that is no longer selected", () => {
    let state = selectTask(createDashboardState(), "t1");
    state = selectTask(state, "t2");

    const updated = applyStreamUpdate(state, "t1", {
      type: "update",
      state: "ANALYZING",
      newEvents: [event("e1")],
    });

    expect(updated).toBe(state);
  });
});
