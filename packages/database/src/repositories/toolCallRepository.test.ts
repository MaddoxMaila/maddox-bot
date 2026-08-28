import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { AgentTaskRepository } from "./agentTaskRepository.js";
import { ToolCallRepository } from "./toolCallRepository.js";

describe("ToolCallRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const agentTasks = new AgentTaskRepository(prisma);
  const repository = new ToolCallRepository(prisma);
  let organizationId: string;
  let repositoryId: string;
  let taskId: string;

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
    const task = await agentTasks.create({ organizationId, repositoryId, trigger: {}, bounds: {} });
    taskId = task.id;
  });

  afterAll(async () => {
    await prisma.toolResult.deleteMany({ where: { toolCall: { taskId } } });
    await prisma.toolCall.deleteMany({ where: { taskId } });
    await prisma.agentTask.delete({ where: { id: taskId } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a tool call together with its 1:1 result, on success", async () => {
    const created = await repository.createCompleted({
      taskId,
      role: "planner",
      toolName: "repo.read_file",
      input: { path: "README.md" },
      permissionDecision: "safe",
      result: { ok: true, output: { content: "# hi\n" }, durationMs: 12 },
    });

    expect(created.toolName).toBe("repo.read_file");
    expect(created.permissionDecision).toBe("safe");

    const result = await prisma.toolResult.findUniqueOrThrow({
      where: { toolCallId: created.id },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ content: "# hi\n" });
    expect(result.error).toBeNull();
    expect(result.durationMs).toBe(12);
  });

  it("creates a tool call together with its result, on failure", async () => {
    const created = await repository.createCompleted({
      taskId,
      role: "planner",
      toolName: "repo.read_file",
      input: { path: "missing.txt" },
      permissionDecision: "safe",
      result: {
        ok: false,
        error: { code: "read_failed", message: "ENOENT" },
        durationMs: 3,
      },
    });

    const result = await prisma.toolResult.findUniqueOrThrow({
      where: { toolCallId: created.id },
    });
    expect(result.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.error).toEqual({ code: "read_failed", message: "ENOENT" });
  });

  it("listByTask returns calls for that task in chronological order", async () => {
    const first = await repository.createCompleted({
      taskId,
      role: "planner",
      toolName: "git.status",
      input: {},
      permissionDecision: "safe",
      result: { ok: true, durationMs: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repository.createCompleted({
      taskId,
      role: "planner",
      toolName: "git.log",
      input: {},
      permissionDecision: "safe",
      result: { ok: true, durationMs: 1 },
    });

    const calls = await repository.listByTask(taskId);
    const firstIndex = calls.findIndex((call) => call.id === first.id);
    const secondIndex = calls.findIndex((call) => call.id === second.id);

    expect(firstIndex).toBeLessThan(secondIndex);
  });
});
