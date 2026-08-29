import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import {
  ApprovalAlreadyDecidedError,
  ApprovalNotFoundError,
  ApprovalRepository,
} from "./approvalRepository.js";

describe("ApprovalRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new ApprovalRepository(prisma);
  let organizationId: string;
  let repositoryId: string;
  let taskId: string;
  let userId: string;

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
    const user = await prisma.user.create({
      data: {
        organizationId,
        email: `reviewer-${suffix}@example.com`,
        displayName: "Reviewer",
        role: "member",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.approval.deleteMany({ where: { taskId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.agentTask.delete({ where: { id: taskId } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a pending approval", async () => {
    const created = await repository.create({
      taskId,
      kind: "plan_approval",
      summary: "Approve the implementation plan for PROJ-1",
    });

    expect(created).toMatchObject({
      taskId,
      kind: "plan_approval",
      status: "pending",
      decidedById: null,
      decidedAt: null,
    });
  });

  it("findById returns the approval, listByTask returns it for its task", async () => {
    const created = await repository.create({ taskId, kind: "plan_approval", summary: "x" });

    expect(await repository.findById(created.id)).toMatchObject({ id: created.id });
    const forTask = await repository.listByTask(taskId);
    expect(forTask.some((approval) => approval.id === created.id)).toBe(true);
  });

  it("listPending includes a freshly created approval and excludes decided ones", async () => {
    const pending = await repository.create({ taskId, kind: "plan_approval", summary: "x" });
    const toDecide = await repository.create({ taskId, kind: "plan_approval", summary: "y" });
    await repository.decide(toDecide.id, "approved");

    const stillPending = await repository.listPending();

    expect(stillPending.some((approval) => approval.id === pending.id)).toBe(true);
    expect(stillPending.some((approval) => approval.id === toDecide.id)).toBe(false);
  });

  it("decide records the decision, timestamp, and decider", async () => {
    const created = await repository.create({ taskId, kind: "plan_approval", summary: "x" });

    const decided = await repository.decide(created.id, "approved", userId);

    expect(decided.status).toBe("approved");
    expect(decided.decidedById).toBe(userId);
    expect(decided.decidedAt).not.toBeNull();
  });

  it("decide works without a decidedById", async () => {
    const created = await repository.create({ taskId, kind: "plan_approval", summary: "x" });
    const decided = await repository.decide(created.id, "denied");
    expect(decided).toMatchObject({ status: "denied", decidedById: null });
  });

  it("throws ApprovalAlreadyDecidedError when deciding an approval that was already decided", async () => {
    const created = await repository.create({ taskId, kind: "plan_approval", summary: "x" });
    await repository.decide(created.id, "approved");

    await expect(repository.decide(created.id, "denied")).rejects.toThrow(
      ApprovalAlreadyDecidedError,
    );
  });

  it("throws ApprovalNotFoundError when deciding an approval that doesn't exist", async () => {
    await expect(repository.decide(createId(), "approved")).rejects.toThrow(ApprovalNotFoundError);
  });
});
