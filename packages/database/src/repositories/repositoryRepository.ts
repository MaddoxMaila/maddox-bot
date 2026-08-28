import type { Prisma, PrismaClient } from "@prisma/client";

export interface CreateRepositoryInput {
  organizationId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl: string;
  jiraProjectKeys?: string[];
  agentTriggerConfig: Record<string, unknown>;
  branchNamingTemplate: string;
  provider?: string;
}

export interface RepositoryRecord {
  id: string;
  organizationId: string;
  provider: string;
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl: string;
  jiraProjectKeys: string[];
  agentTriggerConfig: unknown;
  branchNamingTemplate: string;
  createdAt: Date;
}

export class RepositoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    return this.prisma.repository.create({
      data: {
        organizationId: input.organizationId,
        provider: input.provider ?? "github",
        owner: input.owner,
        name: input.name,
        defaultBranch: input.defaultBranch,
        cloneUrl: input.cloneUrl,
        jiraProjectKeys: input.jiraProjectKeys ?? [],
        agentTriggerConfig: input.agentTriggerConfig as Prisma.InputJsonValue,
        branchNamingTemplate: input.branchNamingTemplate,
      },
    });
  }

  async findById(id: string): Promise<RepositoryRecord | null> {
    return this.prisma.repository.findUnique({ where: { id } });
  }

  async findByOwnerAndName(
    owner: string,
    name: string,
    provider = "github",
  ): Promise<RepositoryRecord | null> {
    return this.prisma.repository.findUnique({
      where: { provider_owner_name: { provider, owner, name } },
    });
  }

  async list(): Promise<RepositoryRecord[]> {
    return this.prisma.repository.findMany({ orderBy: { createdAt: "asc" } });
  }
}
