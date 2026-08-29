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

export interface CreatePullRequestInput {
  taskId: string;
  repositoryId: string;
  providerPrNumber: number;
  url: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
}

const SELECT_FIELDS = {
  id: true,
  taskId: true,
  repositoryId: true,
  providerPrNumber: true,
  url: true,
  title: true,
  status: true,
} as const;

/** Read-only through increment 7 (checking whether an inbound PR event is "ours" before reacting
 * to it). `create` is added here in increment 13, alongside the Implementation Agent — the only
 * thing that populates this table. Status/CI-status updates stay deferred to whatever first needs
 * to track a PR's lifecycle after creation (Phase 2's PR-review/CI-failure workflows). */
export class PullRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePullRequestInput): Promise<PullRequestRecord> {
    return this.prisma.pullRequest.create({
      data: {
        taskId: input.taskId,
        repositoryId: input.repositoryId,
        providerPrNumber: input.providerPrNumber,
        url: input.url,
        title: input.title,
        body: input.body,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
      },
      select: SELECT_FIELDS,
    });
  }

  async findByRepositoryAndProviderNumber(
    repositoryId: string,
    providerPrNumber: number,
  ): Promise<PullRequestRecord | null> {
    return this.prisma.pullRequest.findUnique({
      where: { repositoryId_providerPrNumber: { repositoryId, providerPrNumber } },
      select: SELECT_FIELDS,
    });
  }

  /** `taskId` is unique on this table (1:1 with AgentTask) — used by the worker's crash-resume
   * logic to tell "the Implementation Agent finished, just the state bookkeeping didn't catch up"
   * apart from "the Implementation Agent never got that far", without needing a provider PR number
   * on hand. */
  async findByTaskId(taskId: string): Promise<PullRequestRecord | null> {
    return this.prisma.pullRequest.findUnique({ where: { taskId }, select: SELECT_FIELDS });
  }
}
