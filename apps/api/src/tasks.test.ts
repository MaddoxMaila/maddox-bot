import { Database, testDatabaseUrl } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import { BullMqJobQueue, testRedisUrl } from "@maddox-bot/queue";
import { createId, createLogger } from "@maddox-bot/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./buildApp.js";

describe("task routes", () => {
  const database = Database.forUrl(testDatabaseUrl());
  const agentTriggerQueue = new BullMqJobQueue<AgentTriggerJobPayload>(
    `agent-triggers-test-${createId()}`,
    { redisUrl: testRedisUrl() },
  );
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
});
