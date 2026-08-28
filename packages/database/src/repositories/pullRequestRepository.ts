import type { PrismaClient } from "@prisma/client";

export interface PullRequestRecord {
  id: string;
  taskId: string;
  repositoryId: string;
  providerPrNumber: number;
  url: string;
  title: string;
  status: string;
}

/** Read-only for now — increment 7 needs to check whether an inbound PR event is "ours" before
 * reacting to it. `create`/status-update methods are added in increment 13 alongside real PR
 * creation, which is the only thing that will ever populate this table until then. */
export class PullRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByRepositoryAndProviderNumber(
    repositoryId: string,
    providerPrNumber: number,
  ): Promise<PullRequestRecord | null> {
    return this.prisma.pullRequest.findUnique({
      where: { repositoryId_providerPrNumber: { repositoryId, providerPrNumber } },
      select: {
        id: true,
        taskId: true,
        repositoryId: true,
        providerPrNumber: true,
        url: true,
        title: true,
        status: true,
      },
    });
  }
}
