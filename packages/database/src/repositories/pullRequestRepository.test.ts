import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { PullRequestRepository } from "./pullRequestRepository.js";

describe("PullRequestRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new PullRequestRepository(prisma);
  let organizationId: string;
  let repositoryId: string;
  let taskId: string;
  let pullRequestId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `test-org-${createId()}` } });
    organizationId = org.id;
    const suffix = createId();
    const repo = await prisma.repository.create({
      data: {
        organizationId,
        owner: `owner-${suffix}`,
        name: `repo-${suffix}`,
        defaultBranch: "main",
        cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
        agentTriggerConfig: {},
        branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
      },
    });
    repositoryId = repo.id;
    const task = await prisma.agentTask.create({
      data: { organizationId, repositoryId, trigger: {}, bounds: {} },
    });
    taskId = task.id;
    const pr = await repository.create({
      taskId,
      repositoryId,
      providerPrNumber: 1842,
      url: "https://github.com/owner/repo/pull/1842",
      title: "PROJ-481: Add password reset flow",
      body: "Summary...",
      headBranch: "feature/PROJ-481-password-reset",
      baseBranch: "main",
    });
    pullRequestId = pr.id;
  });

  afterAll(async () => {
    await prisma.pullRequest.delete({ where: { id: pullRequestId } });
    await prisma.agentTask.delete({ where: { id: taskId } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a pull request in the open status by default", async () => {
    // pull_requests.task_id is unique (1:1 with AgentTask) — needs its own task, not `taskId`.
    const otherTask = await prisma.agentTask.create({
      data: { organizationId, repositoryId, trigger: {}, bounds: {} },
    });

    const created = await repository.create({
      taskId: otherTask.id,
      repositoryId,
      providerPrNumber: 1843,
      url: "https://github.com/owner/repo/pull/1843",
      title: "PROJ-482: Add health check endpoint",
      body: "Summary...",
      headBranch: "feature/PROJ-482-health-check",
      baseBranch: "main",
    });

    expect(created).toMatchObject({
      taskId: otherTask.id,
      repositoryId,
      providerPrNumber: 1843,
      url: "https://github.com/owner/repo/pull/1843",
      title: "PROJ-482: Add health check endpoint",
      status: "open",
    });

    await prisma.pullRequest.delete({ where: { id: created.id } });
    await prisma.agentTask.delete({ where: { id: otherTask.id } });
  });

  it("finds a pull request by repository and provider PR number", async () => {
    const found = await repository.findByRepositoryAndProviderNumber(repositoryId, 1842);
    expect(found).toMatchObject({
      id: pullRequestId,
      taskId,
      repositoryId,
      providerPrNumber: 1842,
      status: "open",
    });
  });

  it("returns null for a PR number this platform never created", async () => {
    const found = await repository.findByRepositoryAndProviderNumber(repositoryId, 9999);
    expect(found).toBeNull();
  });

  it("finds a pull request by task id", async () => {
    const found = await repository.findByTaskId(taskId);
    expect(found).toMatchObject({ id: pullRequestId, providerPrNumber: 1842 });
  });

  it("returns null for a task with no pull request yet", async () => {
    const taskWithoutPr = await prisma.agentTask.create({
      data: { organizationId, repositoryId, trigger: {}, bounds: {} },
    });

    const found = await repository.findByTaskId(taskWithoutPr.id);

    expect(found).toBeNull();
    await prisma.agentTask.delete({ where: { id: taskWithoutPr.id } });
  });
});
