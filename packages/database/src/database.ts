import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "./client.js";
import { AgentTaskRepository } from "./repositories/agentTaskRepository.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { PullRequestRepository } from "./repositories/pullRequestRepository.js";
import { ReceivedEventRepository } from "./repositories/receivedEventRepository.js";
import { RepositoryRepository } from "./repositories/repositoryRepository.js";
import { TaskEventRepository } from "./repositories/taskEventRepository.js";
import { ToolCallRepository } from "./repositories/toolCallRepository.js";

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
  readonly taskEvents: TaskEventRepository;
  readonly toolCalls: ToolCallRepository;

  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {
    this.organizations = new OrganizationRepository(prisma);
    this.repositories = new RepositoryRepository(prisma);
    this.agentTasks = new AgentTaskRepository(prisma);
    this.pullRequests = new PullRequestRepository(prisma);
    this.receivedEvents = new ReceivedEventRepository(prisma);
    this.taskEvents = new TaskEventRepository(prisma);
    this.toolCalls = new ToolCallRepository(prisma);
  }

  /**
   * For a caller outside this package that needs a specific connection string (e.g. another
   * package's own integration tests pointing at @maddox-bot/database's `testDatabaseUrl()`)
   * without importing @prisma/client itself — that import stays exclusive to this package.
   */
  static forUrl(databaseUrl: string): Database {
    return new Database(createPrismaClient(databaseUrl));
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
