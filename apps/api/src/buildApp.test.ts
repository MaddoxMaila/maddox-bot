import { createHmac } from "node:crypto";
import { Database, testDatabaseUrl } from "@maddox-bot/database";
import {
  computeDedupeKey,
  type AgentTriggerJobPayload,
  type TaskResumeJobPayload,
} from "@maddox-bot/events";
import { BullMqJobQueue, testRedisUrl } from "@maddox-bot/queue";
import { createId, createLogger } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./buildApp.js";

const GITHUB_SECRET = "test-github-secret";
const JIRA_SECRET = "test-jira-token";

function signGitHub(body: string): string {
  return `sha256=${createHmac("sha256", GITHUB_SECRET).update(body).digest("hex")}`;
}

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

describe("buildApp webhook routes", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const database = new Database(prisma);
  const queueName = `agent-triggers-test-${createId()}`;
  const agentTriggerQueue = new BullMqJobQueue<AgentTriggerJobPayload>(queueName, {
    redisUrl: testRedisUrl(),
  });
  const taskResumeQueue = new BullMqJobQueue<TaskResumeJobPayload>(
    `task-resume-test-${createId()}`,
    { redisUrl: testRedisUrl() },
  );

  let app: FastifyInstance;
  let organizationId: string;
  let repositoryId: string;
  const createdTaskIds: string[] = [];
  const createdPullRequestIds: string[] = [];

  const OWNER = "octocat";
  const REPO = `hello-world-${createId()}`;
  let PROJECT_KEY: string;

  beforeAll(async () => {
    app = await buildApp({
      database,
      agentTriggerQueue,
      taskResumeQueue,
      githubWebhookSecret: GITHUB_SECRET,
      jiraWebhookSecret: JIRA_SECRET,
      logger: createLogger("api-test"),
    });

    const org = await database.organizations.create({ name: `test-org-${createId()}` });
    organizationId = org.id;
    PROJECT_KEY = `PROJ${createId().slice(0, 8).toUpperCase()}`;
    const repo = await database.repositories.create({
      organizationId,
      owner: OWNER,
      name: REPO,
      defaultBranch: "main",
      cloneUrl: `https://github.com/${OWNER}/${REPO}.git`,
      jiraProjectKeys: [PROJECT_KEY],
      agentTriggerConfig: { triggerStatus: "AI READY", triggerLabel: "ai-agent" },
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    repositoryId = repo.id;
  });

  afterAll(async () => {
    await app.close();
    await agentTriggerQueue.close();
    await taskResumeQueue.close();
    // These fixture rows were created via raw Prisma (the PR one predates
    // PullRequestRepository.create()), so cleanup goes through raw Prisma too.
    await prisma.pullRequest.deleteMany({ where: { id: { in: createdPullRequestIds } } });
    await prisma.agentTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.receivedEvent.deleteMany({ where: { repositoryId } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await database.disconnect();
  });

  describe("POST /webhooks/github", () => {
    afterEach(async () => {
      await prisma.receivedEvent.deleteMany({ where: { repositoryId } });
    });

    it("rejects a request with an invalid signature", async () => {
      const body = JSON.stringify({
        action: "opened",
        repository: { full_name: `${OWNER}/${REPO}` },
      });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-github-delivery": `delivery-${createId()}`,
          "x-github-event": "pull_request",
          "x-hub-signature-256": "sha256=not-a-real-signature",
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("rejects a request missing required headers", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: { action: "opened", repository: { full_name: `${OWNER}/${REPO}` } },
      });
      expect(response.statusCode).toBe(400);
    });

    it("accepts a valid signature but marks an untracked repository as not relevant", async () => {
      const body = JSON.stringify({
        action: "opened",
        pull_request: { number: 1, head: { ref: "feature/x" } },
        repository: { full_name: "someone-else/unrelated-repo" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-github-delivery": `delivery-${createId()}`,
          "x-github-event": "pull_request",
          "x-hub-signature-256": signGitHub(body),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "accepted", relevant: false });
    });

    it("marks a tracked repository's non-pull_request event as not relevant", async () => {
      const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-github-delivery": `delivery-${createId()}`,
          "x-github-event": "push",
          "x-hub-signature-256": signGitHub(body),
        },
      });
      expect(response.json()).toEqual({ status: "accepted", relevant: false });
    });

    it("is relevant for an event on a pull request this platform created", async () => {
      const task = await database.agentTasks.create({
        organizationId,
        repositoryId,
        trigger: {},
        bounds: {},
      });
      createdTaskIds.push(task.id);
      // No PullRequestRepository.create() yet (write path is increment 13) — this fixture row has
      // to go through raw Prisma until then.
      const pr = await prisma.pullRequest.create({
        data: {
          taskId: task.id,
          repositoryId,
          providerPrNumber: 777,
          url: "https://github.com/octocat/hello-world/pull/777",
          title: "Test PR",
          body: "",
          headBranch: "feature/x",
          baseBranch: "main",
        },
      });
      createdPullRequestIds.push(pr.id);

      const body = JSON.stringify({
        action: "closed",
        pull_request: { number: 777, head: { ref: "feature/x" }, merged: true },
        repository: { full_name: `${OWNER}/${REPO}` },
      });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-github-delivery": `delivery-${createId()}`,
          "x-github-event": "pull_request",
          "x-hub-signature-256": signGitHub(body),
        },
      });
      expect(response.json()).toEqual({ status: "accepted", relevant: true });
    });

    it("treats a repeated delivery id as a duplicate", async () => {
      const deliveryId = `delivery-${createId()}`;
      const body = JSON.stringify({
        action: "opened",
        pull_request: { number: 2, head: { ref: "feature/y" } },
        repository: { full_name: `${OWNER}/${REPO}` },
      });
      const headers = {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
        "x-hub-signature-256": signGitHub(body),
      };

      const first = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers,
      });
      expect(first.json().status).toBe("accepted");

      const second = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload: body,
        headers,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ status: "duplicate" });
    });
  });

  describe("POST /webhooks/jira", () => {
    afterEach(async () => {
      await prisma.receivedEvent.deleteMany({ where: { repositoryId } });
    });

    it("rejects a request with an invalid token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/jira?token=wrong-token",
        payload: {
          webhookEvent: "jira:issue_updated",
          timestamp: Date.now(),
          issue: {
            key: `${PROJECT_KEY}-1`,
            fields: { status: { name: "AI READY" }, labels: [], assignee: null },
          },
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("marks an unmapped project as not relevant", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/webhooks/jira?token=${JIRA_SECRET}`,
        payload: {
          webhookEvent: "jira:issue_updated",
          timestamp: Date.now(),
          issue: {
            key: "UNMAPPED-1",
            fields: { status: { name: "AI READY" }, labels: [], assignee: null },
          },
          changelog: { items: [{ field: "status", fromString: "BACKLOG", toString: "AI READY" }] },
        },
      });
      expect(response.json()).toEqual({ status: "accepted", relevant: false });
    });

    it("is relevant when status transitions into the configured trigger status, and enqueues a job", async () => {
      // Other tests in this file (e.g. the GitHub "tracked PR" case) enqueue onto this same
      // shared queue and don't consume what they enqueue. Waiting for "whatever job arrives
      // first" is flaky under that leakage; wait for the specific dedupeKey this request will
      // produce instead, and let any other tests' jobs complete normally rather than hanging.
      const issueKey = `${PROJECT_KEY}-42`;
      const timestamp = Date.now();
      const expectedJobId = computeDedupeKey("jira", `${issueKey}-${timestamp}`);

      const received = defer<AgentTriggerJobPayload>();
      const consumer = new BullMqJobQueue<AgentTriggerJobPayload>(queueName, {
        redisUrl: testRedisUrl(),
      });
      consumer.process(async (data, jobId) => {
        if (jobId === expectedJobId) {
          received.resolve(data);
        }
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: `/webhooks/jira?token=${JIRA_SECRET}`,
          payload: {
            webhookEvent: "jira:issue_updated",
            timestamp,
            issue: {
              key: issueKey,
              fields: { status: { name: "AI READY" }, labels: [], assignee: null },
            },
            changelog: {
              items: [{ field: "status", fromString: "BACKLOG", toString: "AI READY" }],
            },
          },
        });
        expect(response.json()).toEqual({ status: "accepted", relevant: true });

        const job = await received.promise;
        expect(job).toMatchObject({
          source: "jira",
          repositoryId,
          externalRefs: { issueKey },
        });
      } finally {
        await consumer.close();
      }
    }, 10000);

    it("treats a repeated (issue, timestamp) pair as a duplicate", async () => {
      const timestamp = Date.now();
      const payload = {
        webhookEvent: "jira:issue_updated",
        timestamp,
        issue: {
          key: `${PROJECT_KEY}-99`,
          fields: { status: { name: "BACKLOG" }, labels: [], assignee: null },
        },
        changelog: { items: [{ field: "description", fromString: "a", toString: "b" }] },
      };

      const first = await app.inject({
        method: "POST",
        url: `/webhooks/jira?token=${JIRA_SECRET}`,
        payload,
      });
      expect(first.json().status).toBe("accepted");

      const second = await app.inject({
        method: "POST",
        url: `/webhooks/jira?token=${JIRA_SECRET}`,
        payload,
      });
      expect(second.json()).toEqual({ status: "duplicate" });
    });
  });
});
