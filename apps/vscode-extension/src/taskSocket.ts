import WebSocket from "ws";
import type { TaskEventDto } from "./apiClient.js";

export interface TaskStreamUpdate {
  type: "update";
  state: string;
  newEvents: TaskEventDto[];
}

export interface TaskStreamError {
  type: "error";
  message: string;
}

export type TaskStreamMessage = TaskStreamUpdate | TaskStreamError;

export interface TaskStreamListener {
  onMessage(message: TaskStreamMessage): void;
}

function isTaskStreamMessage(value: unknown): value is TaskStreamMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "update") {
    return typeof record.state === "string" && Array.isArray(record.newEvents);
  }
  if (record.type === "error") {
    return typeof record.message === "string";
  }
  return false;
}

/** apps/api's WS gateway is reached over ws(s), not http(s) — same host and path, different scheme. */
export function toWebSocketUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/^http/, "ws").replace(/\/+$/, "");
}

export function connectTaskStream(
  apiBaseUrl: string,
  taskId: string,
  listener: TaskStreamListener,
): WebSocket {
  const url = `${toWebSocketUrl(apiBaseUrl)}/tasks/${encodeURIComponent(taskId)}/stream`;
  const socket = new WebSocket(url);

  socket.on("message", (data) => {
    try {
      const parsed: unknown = JSON.parse(data.toString());
      if (isTaskStreamMessage(parsed)) {
        listener.onMessage(parsed);
      }
    } catch {
      // A malformed frame from our own server would be a server bug, not something the extension
      // can act on — drop it rather than crash the extension host over one bad message.
    }
  });

  return socket;
}
