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

describe("approval routes", () => {
  const database = Database.forUrl(testDatabaseUrl());
  const agentTriggerQueue = new BullMqJobQueue<AgentTriggerJobPayload>(
    `agent-triggers-test-${createId()}`,
    { redisUrl: testRedisUrl() },
  );
  const resumeQueueName = `task-resume-test-${createId()}`;
  const taskResumeQueue = new BullMqJobQueue<TaskResumeJobPayload>(resumeQueueName, {
    redisUrl: testRedisUrl(),
  });

  let app: FastifyInstance;
  let organizationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    app = await buildApp({
      database,
      agentTriggerQueue,
      taskResumeQueue,
      githubWebhookSecret: "unused",
      jiraWebhookSecret: "unused",
      logger: createLogger("approvals-test"),
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
  });

  afterAll(async () => {
    await app.close();
    await agentTriggerQueue.close();
    await taskResumeQueue.close();
    await database.disconnect();
  });

  async function createTask() {
    return database.agentTasks.create({ organizationId, repositoryId, trigger: {}, bounds: {} });
  }

  describe("GET /approvals", () => {
    it("includes a freshly created pending approval", async () => {
      const task = await createTask();
      const approval = await database.approvals.create({
        taskId: task.id,
        kind: "plan_approval",
        summary: "Approve the plan",
      });

      const response = await app.inject({ method: "GET", url: "/approvals" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { approvals: Array<{ id: string; status: string }> };
      expect(body.approvals.some((a) => a.id === approval.id && a.status === "pending")).toBe(true);
    });
  });

  describe("POST /approvals/:id/decide", () => {
    it("rejects a missing/invalid decision", async () => {
      const task = await createTask();
      const approval = await database.approvals.create({
        taskId: task.id,
        kind: "plan_approval",
        summary: "x",
      });

      const response = await app.inject({
        method: "POST",
        url: `/approvals/${approval.id}/decide`,
        payload: { decision: "maybe" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("404s for an approval that doesn't exist", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${createId()}/decide`,
        payload: { decision: "approved" },
      });
      expect(response.statusCode).toBe(404);
    });

    it("records the decision and enqueues a task-resume job", async () => {
      const task = await createTask();
      const approval = await database.approvals.create({
        taskId: task.id,
        kind: "plan_approval",
        summary: "x",
      });

      const received = defer<TaskResumeJobPayload>();
      const consumer = new BullMqJobQueue<TaskResumeJobPayload>(resumeQueueName, {
        redisUrl: testRedisUrl(),
      });
      consumer.process(async (data) => {
        if (data.taskId === task.id) {
          received.resolve(data);
        }
      });

      try {
        // No decidedBy: Phase 1 has no authenticated user context in the API layer (and no
        // UserRepository yet to create a real one for this test) — decided_by is a real foreign
        // key to users.id, so an arbitrary string here would fail, not "already decided".
        const response = await app.inject({
          method: "POST",
          url: `/approvals/${approval.id}/decide`,
          payload: { decision: "approved" },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ approval: { status: "approved" } });

        const job = await received.promise;
        expect(job).toEqual({ taskId: task.id });
      } finally {
        await consumer.close();
      }
    }, 10000);

    it("409s when the same approval is decided twice", async () => {
      const task = await createTask();
      const approval = await database.approvals.create({
        taskId: task.id,
        kind: "plan_approval",
        summary: "x",
      });
      await app.inject({
        method: "POST",
        url: `/approvals/${approval.id}/decide`,
        payload: { decision: "denied" },
      });

      const response = await app.inject({
        method: "POST",
        url: `/approvals/${approval.id}/decide`,
        payload: { decision: "approved" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("surfaces an unrelated failure (e.g. an invalid decidedBy) as a 500, not a misleading 409", async () => {
      const task = await createTask();
      const approval = await database.approvals.create({
        taskId: task.id,
        kind: "plan_approval",
        summary: "x",
      });

      // decided_by is a real foreign key to users.id — this string isn't one, so the update itself
      // fails. That's a genuine server error, not "this approval was already decided".
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${approval.id}/decide`,
        payload: { decision: "approved", decidedBy: "not-a-real-user-id" },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
