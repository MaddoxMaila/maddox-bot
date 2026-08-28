import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { RepositoryRepository } from "./repositoryRepository.js";

describe("RepositoryRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new RepositoryRepository(prisma);
  const createdRepositoryIds: string[] = [];
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `test-org-${createId()}` } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { id: { in: createdRepositoryIds } } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a repository with defaults applied", async () => {
    const suffix = createId();
    const created = await repository.create({
      organizationId,
      owner: `owner-${suffix}`,
      name: `repo-${suffix}`,
      defaultBranch: "main",
      cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
      agentTriggerConfig: { triggerStatus: "AI READY" },
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    createdRepositoryIds.push(created.id);

    expect(created.provider).toBe("github");
    expect(created.jiraProjectKeys).toEqual([]);
    expect(created.agentTriggerConfig).toEqual({ triggerStatus: "AI READY" });
  });

  it("finds a repository by owner and name", async () => {
    const suffix = createId();
    const owner = `owner-${suffix}`;
    const name = `repo-${suffix}`;
    const created = await repository.create({
      organizationId,
      owner,
      name,
      defaultBranch: "main",
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    createdRepositoryIds.push(created.id);

    const found = await repository.findByOwnerAndName(owner, name);
    expect(found?.id).toBe(created.id);
  });

  it("rejects a duplicate (provider, owner, name)", async () => {
    const suffix = createId();
    const owner = `owner-${suffix}`;
    const name = `repo-${suffix}`;
    const input = {
      organizationId,
      owner,
      name,
      defaultBranch: "main",
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    };
    const created = await repository.create(input);
    createdRepositoryIds.push(created.id);

    await expect(repository.create(input)).rejects.toThrow();
  });

  it("finds a repository by Jira project key", async () => {
    const suffix = createId();
    const projectKey = `PROJ${suffix.slice(0, 8).toUpperCase()}`;
    const created = await repository.create({
      organizationId,
      owner: `owner-${suffix}`,
      name: `repo-${suffix}`,
      defaultBranch: "main",
      cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
      jiraProjectKeys: [projectKey],
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    createdRepositoryIds.push(created.id);

    const found = await repository.findByJiraProjectKey(projectKey);
    expect(found?.id).toBe(created.id);
  });

  it("returns null for a Jira project key no repository is configured with", async () => {
    const found = await repository.findByJiraProjectKey(`UNMAPPED-${createId()}`);
    expect(found).toBeNull();
  });
});
