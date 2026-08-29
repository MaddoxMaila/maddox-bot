import type { ApprovalDto, TaskEventDto } from "./apiClient.js";
import type { ChatMessage } from "./chatViewModel.js";
import type { DashboardTaskSummary } from "./dashboardViewModel.js";

/** Sent host -> webview whenever chat or dashboard state changes; the webview just re-renders
 * from this, it never holds state of its own. */
export interface RenderMessage {
  type: "render";
  chat: { messages: ChatMessage[] };
  dashboard: {
    tasks: DashboardTaskSummary[];
    selectedTaskId: string | null;
    selectedTaskEvents: TaskEventDto[];
    pendingApprovals: ApprovalDto[];
  };
}

export type HostToWebviewMessage = RenderMessage;

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "chatSubmit"; text: string }
  | { type: "selectTask"; taskId: string }
  | { type: "decideApproval"; approvalId: string; decision: "approved" | "denied" };

/**
 * `panel.webview.onDidReceiveMessage` hands the extension host an untyped payload from the
 * webview's own postMessage call — narrowed here instead of trusting it, since it's crossing a
 * process boundary this package doesn't otherwise control the other side of at the type level.
 */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "ready":
      return true;
    case "chatSubmit":
      return typeof record.text === "string";
    case "selectTask":
      return typeof record.taskId === "string";
    case "decideApproval":
      return (
        typeof record.approvalId === "string" &&
        (record.decision === "approved" || record.decision === "denied")
      );
    default:
      return false;
  }
}
