import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { JiraIssueRepository } from "./jiraIssueRepository.js";

describe("JiraIssueRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new JiraIssueRepository(prisma);
  let organizationId: string;
  let repositoryId: string;
  let issueKey: string;

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
    issueKey = `PROJ-${createId().slice(0, 8)}`;
  });

  afterAll(async () => {
    await prisma.jiraIssue.deleteMany({ where: { issueKey } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a new issue on first upsert", async () => {
    const created = await repository.upsertByIssueKey({
      repositoryId,
      issueKey,
      summary: "Add password reset",
      description: "Users can reset their password.",
      status: "AI READY",
      assignee: "Jane Doe",
      labels: ["ai-agent"],
      raw: { key: issueKey },
    });

    expect(created).toMatchObject({
      issueKey,
      repositoryId,
      summary: "Add password reset",
      description: "Users can reset their password.",
      status: "AI READY",
      assignee: "Jane Doe",
      labels: ["ai-agent"],
    });
  });

  it("findByIssueKey returns the created issue", async () => {
    const found = await repository.findByIssueKey(issueKey);
    expect(found).toMatchObject({ issueKey, summary: "Add password reset" });
  });

  it("findByIssueKey returns null for an issue that was never synced", async () => {
    const found = await repository.findByIssueKey("NOPE-999999");
    expect(found).toBeNull();
  });

  it("findById returns the same row by its database id", async () => {
    const created = await repository.findByIssueKey(issueKey);
    const found = await repository.findById(created?.id ?? "");
    expect(found).toMatchObject({ issueKey, summary: "Add password reset" });
  });

  it("findById returns null for an id that doesn't exist", async () => {
    const found = await repository.findById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("updates the existing row on a second upsert, without creating a duplicate", async () => {
    const updated = await repository.upsertByIssueKey({
      repositoryId,
      issueKey,
      summary: "Add password reset (updated)",
      status: "In Progress",
      labels: ["ai-agent", "in-progress"],
      raw: { key: issueKey, updated: true },
    });

    expect(updated.summary).toBe("Add password reset (updated)");
    expect(updated.status).toBe("In Progress");

    const rows = await prisma.jiraIssue.findMany({ where: { issueKey } });
    expect(rows).toHaveLength(1);
  });
});
