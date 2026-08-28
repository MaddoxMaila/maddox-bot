import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "./database.js";
import { AgentTaskRepository } from "./repositories/agentTaskRepository.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { RepositoryRepository } from "./repositories/repositoryRepository.js";
import { testDatabaseUrl } from "./testDatabaseUrl.js";

describe("Database", () => {
  const db = new Database(new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } }));

  afterAll(async () => {
    await db.disconnect();
  });

  it("wires up all three repositories", () => {
    expect(db.organizations).toBeInstanceOf(OrganizationRepository);
    expect(db.repositories).toBeInstanceOf(RepositoryRepository);
    expect(db.agentTasks).toBeInstanceOf(AgentTaskRepository);
  });

  it("can be constructed with the default client", async () => {
    const defaultDb = new Database();
    expect(defaultDb.organizations).toBeInstanceOf(OrganizationRepository);
    await defaultDb.disconnect();
  });
});
