import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchMaddoxApiClient, MaddoxApiError } from "./apiClient.js";

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

/**
 * A real local HTTP server standing in for apps/api, rather than mocking `fetch` — consistent with
 * this repo's preference for exercising real request/response handling wherever feasible.
 */
function startFakeApiServer(): {
  server: Server;
  requests: RecordedRequest[];
  respond: (method: string, path: string, status: number, body: unknown) => void;
} {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, { status: number; body: unknown }>();

  function respond(method: string, path: string, status: number, body: unknown): void {
    routes.set(`${method} ${path}`, { status, body });
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsedBody: unknown = raw.length > 0 ? JSON.parse(raw) : undefined;
      requests.push({ method: request.method ?? "", url: request.url ?? "", body: parsedBody });

      const key = `${request.method} ${request.url}`;
      const route = routes.get(key);
      if (!route) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: `no fake route for ${key}` }));
        return;
      }
      response.writeHead(route.status, { "content-type": "application/json" });
      response.end(JSON.stringify(route.body));
    });
  });

  return {
    server,
    requests,
    respond,
  };
}

describe("FetchMaddoxApiClient", () => {
  let fake: ReturnType<typeof startFakeApiServer>;
  let baseUrl: string;
  let client: FetchMaddoxApiClient;

  beforeAll(async () => {
    fake = startFakeApiServer();
    await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
    const address = fake.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the fake server to bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    client = new FetchMaddoxApiClient(baseUrl);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });

  it("listTasks sends repositoryId as a query param and returns the tasks array", async () => {
    fake.respond("GET", "/tasks?repositoryId=repo-1", 200, {
      tasks: [{ id: "task-1", repositoryId: "repo-1", state: "CREATED" }],
    });

    const tasks = await client.listTasks("repo-1");

    expect(tasks).toEqual([{ id: "task-1", repositoryId: "repo-1", state: "CREATED" }]);
  });

  it("getTask returns the task", async () => {
    fake.respond("GET", "/tasks/task-1", 200, { task: { id: "task-1", state: "PLANNED" } });

    const task = await client.getTask("task-1");

    expect(task).toEqual({ id: "task-1", state: "PLANNED" });
  });

  it("getTaskByReceivedEvent returns null when nothing matches yet", async () => {
    fake.respond("GET", "/tasks/by-received-event/evt-1", 200, { task: null });

    expect(await client.getTaskByReceivedEvent("evt-1")).toBeNull();
  });

  it("implementIssue POSTs repositoryId and issueKey as JSON and returns the receivedEventId", async () => {
    fake.respond("POST", "/tasks", 202, { receivedEventId: "evt-42" });

    const result = await client.implementIssue("repo-1", "PROJ-42");

    expect(result).toEqual({ receivedEventId: "evt-42" });
    const request = fake.requests.at(-1);
    expect(request?.body).toEqual({ repositoryId: "repo-1", issueKey: "PROJ-42" });
  });

  it("cancelTask POSTs to the cancel endpoint and returns the updated task", async () => {
    fake.respond("POST", "/tasks/task-1/cancel", 200, {
      task: { id: "task-1", state: "CANCELLED" },
    });

    const task = await client.cancelTask("task-1");

    expect(task).toEqual({ id: "task-1", state: "CANCELLED" });
  });

  it("getPullRequest returns null before one exists", async () => {
    fake.respond("GET", "/tasks/task-1/pull-request", 200, { pullRequest: null });

    expect(await client.getPullRequest("task-1")).toBeNull();
  });

  it("listPendingApprovals returns the approvals array", async () => {
    fake.respond("GET", "/approvals", 200, {
      approvals: [{ id: "appr-1", status: "pending" }],
    });

    expect(await client.listPendingApprovals()).toEqual([{ id: "appr-1", status: "pending" }]);
  });

  it("decideApproval POSTs the decision and returns the decided approval", async () => {
    fake.respond("POST", "/approvals/appr-1/decide", 200, {
      approval: { id: "appr-1", status: "approved" },
    });

    const approval = await client.decideApproval("appr-1", "approved");

    expect(approval).toEqual({ id: "appr-1", status: "approved" });
    const request = fake.requests.at(-1);
    expect(request?.body).toEqual({ decision: "approved" });
  });

  it("throws MaddoxApiError with the server's error message and status on a non-2xx response", async () => {
    fake.respond("GET", "/tasks/missing", 404, { error: "task not found" });

    await expect(client.getTask("missing")).rejects.toMatchObject(
      new MaddoxApiError(404, "task not found"),
    );
  });
});
