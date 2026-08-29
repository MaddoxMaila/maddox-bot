import type { ApprovalDto, TaskDto, TaskEventDto } from "./apiClient.js";
import type { TaskStreamUpdate } from "./taskSocket.js";

export interface DashboardTaskSummary {
  id: string;
  state: string;
  createdAt: string;
}

export interface DashboardState {
  tasks: DashboardTaskSummary[];
  selectedTaskId: string | null;
  selectedTaskEvents: TaskEventDto[];
  pendingApprovals: ApprovalDto[];
}

export function createDashboardState(): DashboardState {
  return { tasks: [], selectedTaskId: null, selectedTaskEvents: [], pendingApprovals: [] };
}

export function applyTaskList(state: DashboardState, tasks: TaskDto[]): DashboardState {
  return {
    ...state,
    tasks: tasks.map((task) => ({ id: task.id, state: task.state, createdAt: task.createdAt })),
  };
}

export function applyPendingApprovals(
  state: DashboardState,
  approvals: ApprovalDto[],
): DashboardState {
  return { ...state, pendingApprovals: approvals };
}

/** Resets the event log — the task-stream connection's first message is a full snapshot (every
 * existing event), so there's nothing worth carrying over from whatever was selected before. */
export function selectTask(state: DashboardState, taskId: string): DashboardState {
  return { ...state, selectedTaskId: taskId, selectedTaskEvents: [] };
}

/**
 * `taskId` identifies which task's WS connection this update came from — a connection for a task
 * the user has since deselected is stale and should be ignored rather than corrupting whatever is
 * now selected (the host is expected to close stale connections, but this makes the view model
 * correct even if one delivers one more message first).
 */
export function applyStreamUpdate(
  state: DashboardState,
  taskId: string,
  update: TaskStreamUpdate,
): DashboardState {
  if (state.selectedTaskId !== taskId) {
    return state;
  }
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId ? { ...task, state: update.state } : task,
    ),
    selectedTaskEvents: [...state.selectedTaskEvents, ...update.newEvents],
  };
}
