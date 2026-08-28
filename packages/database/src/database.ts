import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "./client.js";
import { AgentTaskRepository } from "./repositories/agentTaskRepository.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { PullRequestRepository } from "./repositories/pullRequestRepository.js";
import { ReceivedEventRepository } from "./repositories/receivedEventRepository.js";
import { RepositoryRepository } from "./repositories/repositoryRepository.js";

/**
 * The only object other packages construct. Wraps a single PrismaClient and hands out
 * repository instances so nothing outside this package ever imports @prisma/client directly.
 */
export class Database {
  readonly organizations: OrganizationRepository;
  readonly repositories: RepositoryRepository;
  readonly agentTasks: AgentTaskRepository;
  readonly pullRequests: PullRequestRepository;
  readonly receivedEvents: ReceivedEventRepository;

  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {
    this.organizations = new OrganizationRepository(prisma);
    this.repositories = new RepositoryRepository(prisma);
    this.agentTasks = new AgentTaskRepository(prisma);
    this.pullRequests = new PullRequestRepository(prisma);
    this.receivedEvents = new ReceivedEventRepository(prisma);
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
