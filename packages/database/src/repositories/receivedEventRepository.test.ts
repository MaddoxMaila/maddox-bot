import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { ReceivedEventRepository } from "./receivedEventRepository.js";

describe("ReceivedEventRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new ReceivedEventRepository(prisma);
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.receivedEvent.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it("creates a new event", async () => {
    const sourceEventId = `delivery-${createId()}`;
    const created = await repository.createIfNew({
      source: "github",
      sourceEventId,
      eventType: "github.pull_request.opened",
      isRelevant: false,
      relevanceReason: "not_a_platform_created_pull_request",
      payload: { action: "opened" },
    });
    if (created === null) {
      throw new Error("expected createIfNew to return a record for a fresh sourceEventId");
    }
    createdIds.push(created.id);

    expect(created).toMatchObject({
      source: "github",
      sourceEventId,
      isRelevant: false,
      relevanceReason: "not_a_platform_created_pull_request",
      organizationId: null,
      repositoryId: null,
    });
  });

  it("returns null instead of throwing for a duplicate (source, sourceEventId)", async () => {
    const sourceEventId = `delivery-${createId()}`;
    const first = await repository.createIfNew({
      source: "jira",
      sourceEventId,
      eventType: "jira:issue_updated",
      isRelevant: true,
      relevanceReason: "status_transitioned_to_trigger",
      payload: {},
    });
    if (first === null) {
      throw new Error("expected the first createIfNew call to succeed");
    }
    createdIds.push(first.id);

    const duplicate = await repository.createIfNew({
      source: "jira",
      sourceEventId,
      eventType: "jira:issue_updated",
      isRelevant: true,
      relevanceReason: "status_transitioned_to_trigger",
      payload: {},
    });

    expect(duplicate).toBeNull();
  });
});
