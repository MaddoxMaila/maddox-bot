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
    // No PullRequestRepository.create() yet (write path is increment 13) — insert directly via
    // Prisma here, the same way any other pre-increment-13 test fixture would have to.
    const pr = await prisma.pullRequest.create({
      data: {
        taskId,
        repositoryId,
        providerPrNumber: 1842,
        url: "https://github.com/owner/repo/pull/1842",
        title: "PROJ-481: Add password reset flow",
        body: "Summary...",
        headBranch: "feature/PROJ-481-password-reset",
        baseBranch: "main",
      },
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
});
