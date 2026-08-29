import { Database, testDatabaseUrl } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import { BullMqJobQueue, testRedisUrl } from "@maddox-bot/queue";
import { createId, createLogger } from "@maddox-bot/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./buildApp.js";

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

describe("task routes", () => {
  const database = Database.forUrl(testDatabaseUrl());
  const agentTriggerQueueName = `agent-triggers-test-${createId()}`;
  const agentTriggerQueue = new BullMqJobQueue<AgentTriggerJobPayload>(agentTriggerQueueName, {
    redisUrl: testRedisUrl(),
  });
  const taskResumeQueue = new BullMqJobQueue<TaskResumeJobPayload>(
    `task-resume-test-${createId()}`,
    { redisUrl: testRedisUrl() },
  );

  let app: FastifyInstance;
  let organizationId: string;
  let repositoryId: string;
  let taskId: string;

  beforeAll(async () => {
    app = await buildApp({
      database,
      agentTriggerQueue,
      taskResumeQueue,
      githubWebhookSecret: "unused",
      jiraWebhookSecret: "unused",
      logger: createLogger("tasks-test"),
    });

    const org = await database.organizations.create({ name: `test-org-${createId()}` });
    organizationId = org.id;
    const suffix = createId();
    const repo = await database.repositories.create({
      organizationId,
      owner: `owner-${suffix}`,
      name: `repo-${suffix}`,
      defaultBranch: "main",
      cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    repositoryId = repo.id;
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: { kind: "jira_event" },
      bounds: {},
    });
    taskId = task.id;
    await database.taskEvents.create({
      taskId,
      type: "state_changed",
      payload: { from: "CREATED", to: "ANALYZING" },
    });
    await database.toolCalls.createCompleted({
      taskId,
      role: "planner",
      toolName: "repo.list_files",
      input: {},
      permissionDecision: "safe",
      result: { ok: true, durationMs: 5 },
    });
  });

  afterAll(async () => {
    await app.close();
    await agentTriggerQueue.close();
    await taskResumeQueue.close();
    await database.disconnect();
  });

  describe("GET /tasks", () => {
    it("requires repositoryId", async () => {
      const response = await app.inject({ method: "GET", url: "/tasks" });
      expect(response.statusCode).toBe(400);
    });

    it("lists tasks for the given repository", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/tasks?repositoryId=${repositoryId}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { tasks: Array<{ id: string }> };
      expect(body.tasks.some((task) => task.id === taskId)).toBe(true);
    });
  });

  describe("GET /tasks/:id", () => {
    it("returns the task", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${taskId}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ task: { id: taskId, state: "CREATED" } });
    });

    it("404s for a task that doesn't exist", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${createId()}` });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /tasks/:id/events", () => {
    it("returns the task's events", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${taskId}/events` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { events: Array<{ type: string }> };
      expect(body.events.some((event) => event.type === "state_changed")).toBe(true);
    });

    it("404s for a task that doesn't exist", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${createId()}/events` });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /tasks/:id/tool-calls", () => {
    it("returns the task's tool calls", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${taskId}/tool-calls` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { toolCalls: Array<{ toolName: string }> };
      expect(body.toolCalls.some((call) => call.toolName === "repo.list_files")).toBe(true);
    });
  });

  describe("GET /tasks/:id/approvals", () => {
    it("returns an empty list for a task with no approvals yet", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${taskId}/approvals` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ approvals: [] });
    });

    it("404s for a task that doesn't exist", async () => {
      const response = await app.inject({ method: "GET", url: `/tasks/${createId()}/approvals` });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /tasks (direct trigger)", () => {
    it("rejects a missing repositoryId or issueKey", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { repositoryId },
      });
      expect(response.statusCode).toBe(400);
    });

    it("404s for a repository that doesn't exist", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { repositoryId: createId(), issueKey: "PROJ-1" },
      });
      expect(response.statusCode).toBe(404);
    });

    it("enqueues a direct AgentTriggerJobPayload and returns its receivedEventId", async () => {
      const received = defer<AgentTriggerJobPayload>();
      const consumer = new BullMqJobQueue<AgentTriggerJobPayload>(agentTriggerQueueName, {
        redisUrl: testRedisUrl(),
      });
      consumer.process(async (data) => {
        if (data.eventType === "direct.implement_issue" && data.repositoryId === repositoryId) {
          received.resolve(data);
        }
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/tasks",
          payload: { repositoryId, issueKey: "PROJ-42" },
        });

        expect(response.statusCode).toBe(202);
        const body = response.json() as { receivedEventId: string };
        expect(body.receivedEventId).toEqual(expect.any(String));

        const job = await received.promise;
        expect(job).toMatchObject({
          source: "direct",
          repositoryId,
          externalRefs: { issueKey: "PROJ-42" },
          receivedEventId: body.receivedEventId,
        });
      } finally {
        await consumer.close();
      }
    }, 10000);
  });

  describe("GET /tasks/by-received-event/:receivedEventId", () => {
    it("returns null when no task matches", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/tasks/by-received-event/${createId()}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ task: null });
    });

    it("returns the task a prior job attempt produced", async () => {
      const receivedEventId = createId();
      const produced = await database.agentTasks.create({
        organizationId,
        repositoryId,
        trigger: { kind: "direct", receivedEventId },
        bounds: {},
      });

      const response = await app.inject({
        method: "GET",
        url: `/tasks/by-received-event/${receivedEventId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ task: { id: produced.id } });
    });
  });

  describe("GET /tasks/:id/pull-request", () => {
    it("returns null for a task with no pull request yet", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/tasks/${taskId}/pull-request`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pullRequest: null });
    });

    it("404s for a task that doesn't exist", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/tasks/${createId()}/pull-request`,
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns the linked pull request once one exists", async () => {
      const task = await database.agentTasks.create({
        organizationId,
        repositoryId,
        trigger: {},
        bounds: {},
      });
      const pullRequest = await database.pullRequests.create({
        taskId: task.id,
        repositoryId,
        providerPrNumber: 99,
        url: "https://github.com/acme/sample/pull/99",
        title: "Implement PROJ-1",
        body: "Closes PROJ-1",
        headBranch: "feature/proj-1",
        baseBranch: "main",
      });

      const response = await app.inject({
        method: "GET",
        url: `/tasks/${task.id}/pull-request`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        pullRequest: { id: pullRequest.id, url: pullRequest.url },
      });
    });
  });

  describe("POST /tasks/:id/cancel", () => {
    it("404s for a task that doesn't exist", async () => {
      const response = await app.inject({ method: "POST", url: `/tasks/${createId()}/cancel` });
      expect(response.statusCode).toBe(404);
    });

    it("cancels a task in a non-terminal state", async () => {
      const task = await database.agentTasks.create({
        organizationId,
        repositoryId,
        trigger: {},
        bounds: {},
      });

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/cancel` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ task: { id: task.id, state: "CANCELLED" } });
    });

    it("409s for a task already in a terminal state", async () => {
      const task = await database.agentTasks.create({
        organizationId,
        repositoryId,
        trigger: {},
        bounds: {},
      });
      await app.inject({ method: "POST", url: `/tasks/${task.id}/cancel` });

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/cancel` });

      expect(response.statusCode).toBe(409);
    });
  });
});
