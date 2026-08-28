import type { PrismaClient } from "@prisma/client";

export interface CreateOrganizationInput {
  name: string;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  createdAt: Date;
}

export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOrganizationInput): Promise<OrganizationRecord> {
    return this.prisma.organization.create({ data: input });
  }

  async findById(id: string): Promise<OrganizationRecord | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async list(): Promise<OrganizationRecord[]> {
    return this.prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  }
}
