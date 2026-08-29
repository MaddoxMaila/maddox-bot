import type { Prisma, PrismaClient } from "@prisma/client";

export interface UpsertJiraIssueInput {
  repositoryId?: string;
  issueKey: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: string;
  labels: string[];
  raw: Record<string, unknown>;
}

export interface JiraIssueRecord {
  id: string;
  repositoryId: string | null;
  issueKey: string;
  summary: string;
  description: string | null;
  status: string;
  assignee: string | null;
  labels: string[];
}

const SELECT_FIELDS = {
  id: true,
  repositoryId: true,
  issueKey: true,
  summary: true,
  description: true,
  status: true,
  assignee: true,
  labels: true,
} as const;

/**
 * The worker's own read-through cache of Jira's current issue state: `upsertByIssueKey` is called
 * every time a job needs the issue's live detail, keeping this table's `lastSyncedAt` current
 * without a separate polling mechanism.
 */
export class JiraIssueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByIssueKey(input: UpsertJiraIssueInput): Promise<JiraIssueRecord> {
    const raw = input.raw as Prisma.InputJsonValue;
    return this.prisma.jiraIssue.upsert({
      where: { issueKey: input.issueKey },
      create: {
        issueKey: input.issueKey,
        summary: input.summary,
        status: input.status,
        labels: input.labels,
        raw,
        ...(input.repositoryId !== undefined && { repositoryId: input.repositoryId }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.assignee !== undefined && { assignee: input.assignee }),
      },
      update: {
        summary: input.summary,
        status: input.status,
        labels: input.labels,
        raw,
        lastSyncedAt: new Date(),
        ...(input.repositoryId !== undefined && { repositoryId: input.repositoryId }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.assignee !== undefined && { assignee: input.assignee }),
      },
      select: SELECT_FIELDS,
    });
  }

  async findByIssueKey(issueKey: string): Promise<JiraIssueRecord | null> {
    return this.prisma.jiraIssue.findUnique({ where: { issueKey }, select: SELECT_FIELDS });
  }

  /** `agent_tasks.jira_issue_id` is this table's id, not the human-readable issue key — the worker
   * needs this to go from a task back to the issue it implements. */
  async findById(id: string): Promise<JiraIssueRecord | null> {
    return this.prisma.jiraIssue.findUnique({ where: { id }, select: SELECT_FIELDS });
  }
}
