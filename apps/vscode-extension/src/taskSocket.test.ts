import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket as ServerWebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTaskStream, toWebSocketUrl, type TaskStreamMessage } from "./taskSocket.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface ServerConnection {
  socket: ServerWebSocket;
  request: IncomingMessage;
}

function waitForConnection(server: WebSocketServer): Promise<ServerConnection> {
  return new Promise((resolve) => {
    server.once("connection", (socket, request) => resolve({ socket, request }));
  });
}

describe("toWebSocketUrl", () => {
  it("swaps http(s) for ws(s) and strips a trailing slash", () => {
    expect(toWebSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000");
    expect(toWebSocketUrl("https://example.com/")).toBe("wss://example.com");
  });
});

describe("connectTaskStream", () => {
  let server: WebSocketServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the fake ws server to bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("connects to /tasks/:id/stream", async () => {
    const connection = waitForConnection(server);
    const client = connectTaskStream(baseUrl, "task-1", { onMessage: () => {} });

    const [{ request }] = await Promise.all([
      connection,
      new Promise<void>((resolve) => client.once("open", resolve)),
    ]);

    expect(request.url).toBe("/tasks/task-1/stream");
    client.close();
  });

  it("parses and delivers an 'update' message", async () => {
    const connection = waitForConnection(server);
    const firstMessage = defer<TaskStreamMessage>();
    const client = connectTaskStream(baseUrl, "task-1", {
      onMessage: (message) => firstMessage.resolve(message),
    });

    const { socket } = await connection;
    socket.send(JSON.stringify({ type: "update", state: "PLANNED", newEvents: [{ id: "evt-1" }] }));

    expect(await firstMessage.promise).toEqual({
      type: "update",
      state: "PLANNED",
      newEvents: [{ id: "evt-1" }],
    });

    client.close();
  });

  it("parses and delivers an 'error' message", async () => {
    const connection = waitForConnection(server);
    const firstMessage = defer<TaskStreamMessage>();
    const client = connectTaskStream(baseUrl, "task-1", {
      onMessage: (message) => firstMessage.resolve(message),
    });

    const { socket } = await connection;
    socket.send(JSON.stringify({ type: "error", message: "task not found" }));

    expect(await firstMessage.promise).toEqual({ type: "error", message: "task not found" });

    client.close();
  });

  it("silently ignores a malformed frame, then still delivers a later valid one", async () => {
    const connection = waitForConnection(server);
    const firstMessage = defer<TaskStreamMessage>();
    const client = connectTaskStream(baseUrl, "task-1", {
      onMessage: (message) => firstMessage.resolve(message),
    });

    const { socket } = await connection;
    socket.send("not json");
    socket.send(JSON.stringify({ type: "something_else" }));
    socket.send(JSON.stringify({ type: "error", message: "still works" }));

    expect(await firstMessage.promise).toEqual({ type: "error", message: "still works" });

    client.close();
  });
});
