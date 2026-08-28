import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { OrganizationRepository } from "./organizationRepository.js";

describe("OrganizationRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const repository = new OrganizationRepository(prisma);
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it("creates and retrieves an organization", async () => {
    const name = `test-org-${createId()}`;
    const created = await repository.create({ name });
    createdIds.push(created.id);

    expect(created.name).toBe(name);
    expect(created.createdAt).toBeInstanceOf(Date);

    const found = await repository.findById(created.id);
    expect(found).toEqual(created);
  });

  it("returns null for an organization that does not exist", async () => {
    const found = await repository.findById(createId());
    expect(found).toBeNull();
  });

  it("lists organizations ordered by creation time", async () => {
    const first = await repository.create({ name: `test-org-${createId()}` });
    const second = await repository.create({ name: `test-org-${createId()}` });
    createdIds.push(first.id, second.id);

    const all = await repository.list();
    const firstIndex = all.findIndex((org) => org.id === first.id);
    const secondIndex = all.findIndex((org) => org.id === second.id);

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });
});
