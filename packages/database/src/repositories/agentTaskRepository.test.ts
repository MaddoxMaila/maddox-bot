import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { AgentTaskRepository } from "./agentTaskRepository.js";

describe("AgentTaskRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new AgentTaskRepository(prisma);
  const createdTaskIds: string[] = [];
  let organizationId: string;
  let repositoryId: string;

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
  });

  afterAll(async () => {
    await prisma.agentTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a task in the CREATED state with no previous state", async () => {
    const created = await repository.create({
      organizationId,
      repositoryId,
      trigger: { kind: "explicit_command", command: "Implement PROJ-481" },
      bounds: { maxToolCalls: 40, maxDurationMinutes: 30 },
    });
    createdTaskIds.push(created.id);

    expect(created.state).toBe("CREATED");
    expect(created.previousState).toBeNull();
    expect(created.type).toBe("jira_implementation");
  });

  it("round-trips a valid state through findById", async () => {
    const created = await repository.create({
      organizationId,
      repositoryId,
      trigger: { kind: "explicit_command", command: "Implement PROJ-482" },
      bounds: {},
    });
    createdTaskIds.push(created.id);

    const found = await repository.findById(created.id);
    expect(found?.state).toBe("CREATED");
  });

  it("updateState records the previous state and returns the new one", async () => {
    const created = await repository.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    createdTaskIds.push(created.id);

    const analyzing = await repository.updateState(created.id, "ANALYZING");
    expect(analyzing.state).toBe("ANALYZING");
    expect(analyzing.previousState).toBe("CREATED");

    const planned = await repository.updateState(created.id, "PLANNED");
    expect(planned.state).toBe("PLANNED");
    expect(planned.previousState).toBe("ANALYZING");
  });

  it("throws when a corrupt state value cannot be recognized", async () => {
    const created = await repository.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    createdTaskIds.push(created.id);
    await prisma.agentTask.update({ where: { id: created.id }, data: { state: "NOT_A_STATE" } });

    await expect(repository.findById(created.id)).rejects.toThrow(/Corrupt agent_tasks.state/);

    // Repair immediately so this corrupt row doesn't poison other tests sharing `repositoryId`
    // (e.g. listByRepository, which maps every row through the same validation).
    await prisma.agentTask.update({ where: { id: created.id }, data: { state: "CREATED" } });
  });

  it("listByRepository returns tasks for that repository, newest first", async () => {
    const older = await repository.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await repository.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    createdTaskIds.push(older.id, newer.id);

    const tasks = await repository.listByRepository(repositoryId);
    const olderIndex = tasks.findIndex((task) => task.id === older.id);
    const newerIndex = tasks.findIndex((task) => task.id === newer.id);

    expect(newerIndex).toBeLessThan(olderIndex);
  });
});
