import { Database, testDatabaseUrl } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import { BullMqJobQueue, testRedisUrl } from "@maddox-bot/queue";
import { createId, createLogger } from "@maddox-bot/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "./buildApp.js";

const POLL_INTERVAL_MS = 50;

describe("GET /tasks/:id/stream (WebSocket)", () => {
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
  let wsBaseUrl: string;
  let organizationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    app = await buildApp(
      {
        database,
        agentTriggerQueue,
        taskResumeQueue,
        githubWebhookSecret: "unused",
        jiraWebhookSecret: "unused",
        logger: createLogger("task-stream-test"),
      },
      { taskStreamPollIntervalMs: POLL_INTERVAL_MS },
    );

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    wsBaseUrl = address.replace("http://", "ws://");

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

  function connect(taskId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${wsBaseUrl}/tasks/${taskId}/stream`);
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  function nextMessage(socket: WebSocket): Promise<unknown> {
    return new Promise((resolve) => {
      socket.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
    });
  }

  it("sends an error and closes for a task that doesn't exist", async () => {
    const socket = await connect(createId());
    const message = await nextMessage(socket);
    expect(message).toMatchObject({ type: "error" });
    await new Promise((resolve) => socket.once("close", resolve));
  });

  it("sends an initial snapshot, then pushes new events as they happen", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    const socket = await connect(task.id);

    const snapshot = await nextMessage(socket);
    expect(snapshot).toMatchObject({ type: "update", state: "CREATED", newEvents: [] });

    await database.agentTasks.updateState(task.id, "ANALYZING");
    await database.taskEvents.create({
      taskId: task.id,
      type: "state_changed",
      payload: { from: "CREATED", to: "ANALYZING" },
    });

    const update = (await nextMessage(socket)) as {
      type: string;
      state: string;
      newEvents: Array<{ type: string }>;
    };
    expect(update).toMatchObject({ type: "update", state: "ANALYZING" });
    expect(update.newEvents).toHaveLength(1);
    expect(update.newEvents[0]?.type).toBe("state_changed");

    socket.close();
  }, 10000);

  it("does not resend events already seen, or push when nothing changed", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    await database.taskEvents.create({ taskId: task.id, type: "state_changed", payload: {} });
    const socket = await connect(task.id);

    const snapshot = (await nextMessage(socket)) as { newEvents: unknown[] };
    expect(snapshot.newEvents).toHaveLength(1);

    let receivedAnother = false;
    socket.once("message", () => {
      receivedAnother = true;
    });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 4));
    expect(receivedAnother).toBe(false);

    socket.close();
  }, 10000);
});
