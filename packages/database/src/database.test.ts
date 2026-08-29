import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "./database.js";
import { AgentTaskRepository } from "./repositories/agentTaskRepository.js";
import { JiraIssueRepository } from "./repositories/jiraIssueRepository.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { PullRequestRepository } from "./repositories/pullRequestRepository.js";
import { ReceivedEventRepository } from "./repositories/receivedEventRepository.js";
import { RepositoryRepository } from "./repositories/repositoryRepository.js";
import { TaskEventRepository } from "./repositories/taskEventRepository.js";
import { ToolCallRepository } from "./repositories/toolCallRepository.js";
import { testDatabaseUrl } from "./testDatabaseUrl.js";

describe("Database", () => {
  const db = new Database(new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } }));

  afterAll(async () => {
    await db.disconnect();
  });

  it("wires up all eight repositories", () => {
    expect(db.organizations).toBeInstanceOf(OrganizationRepository);
    expect(db.repositories).toBeInstanceOf(RepositoryRepository);
    expect(db.agentTasks).toBeInstanceOf(AgentTaskRepository);
    expect(db.pullRequests).toBeInstanceOf(PullRequestRepository);
    expect(db.receivedEvents).toBeInstanceOf(ReceivedEventRepository);
    expect(db.taskEvents).toBeInstanceOf(TaskEventRepository);
    expect(db.toolCalls).toBeInstanceOf(ToolCallRepository);
    expect(db.jiraIssues).toBeInstanceOf(JiraIssueRepository);
  });

  it("can be constructed with the default client", async () => {
    const defaultDb = new Database();
    expect(defaultDb.organizations).toBeInstanceOf(OrganizationRepository);
    await defaultDb.disconnect();
  });

  it("forUrl builds a fully-wired Database for an explicit connection string", async () => {
    const urlDb = Database.forUrl(testDatabaseUrl());
    expect(urlDb.agentTasks).toBeInstanceOf(AgentTaskRepository);
    await urlDb.organizations.list();
    await urlDb.disconnect();
  });
});
