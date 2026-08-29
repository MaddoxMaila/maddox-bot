import type { Prisma, PrismaClient } from "@prisma/client";
import { isTaskState, type TaskState } from "@maddox-bot/shared";

export interface CreateAgentTaskInput {
  organizationId: string;
  repositoryId: string;
  sessionId?: string;
  jiraIssueId?: string;
  type?: string;
  trigger: Record<string, unknown>;
  bounds: Record<string, unknown>;
}

export interface AgentTaskRecord {
  id: string;
  sessionId: string | null;
  organizationId: string;
  repositoryId: string;
  jiraIssueId: string | null;
  type: string;
  state: TaskState;
  previousState: TaskState | null;
  plan: unknown;
  trigger: unknown;
  bounds: unknown;
  retryCounts: unknown;
  error: unknown;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AgentTaskRow {
  id: string;
  sessionId: string | null;
  organizationId: string;
  repositoryId: string;
  jiraIssueId: string | null;
  type: string;
  state: string;
  previousState: string | null;
  plan: unknown;
  trigger: unknown;
  bounds: unknown;
  retryCounts: unknown;
  error: unknown;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toTaskState(value: string): TaskState {
  if (!isTaskState(value)) {
    throw new Error(`Corrupt agent_tasks.state value: "${value}"`);
  }
  return value;
}

function toRecord(row: AgentTaskRow): AgentTaskRecord {
  return {
    ...row,
    state: toTaskState(row.state),
    previousState: row.previousState === null ? null : toTaskState(row.previousState),
  };
}

export class AgentTaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAgentTaskInput): Promise<AgentTaskRecord> {
    const row = await this.prisma.agentTask.create({
      data: {
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
        ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
        ...(input.jiraIssueId !== undefined && { jiraIssueId: input.jiraIssueId }),
        type: input.type ?? "jira_implementation",
        state: "CREATED" satisfies TaskState,
        trigger: input.trigger as Prisma.InputJsonValue,
        bounds: input.bounds as Prisma.InputJsonValue,
        retryCounts: {},
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<AgentTaskRecord | null> {
    const row = await this.prisma.agentTask.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listByRepository(repositoryId: string): Promise<AgentTaskRecord[]> {
    const rows = await this.prisma.agentTask.findMany({
      where: { repositoryId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  /** Across every repository — used by the worker's startup recovery to find tasks a prior crash
   * left mid-flight, without needing to already know which repository they belong to. */
  async listByStates(states: TaskState[]): Promise<AgentTaskRecord[]> {
    const rows = await this.prisma.agentTask.findMany({
      where: { state: { in: states } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }

  /**
   * `trigger.receivedEventId` is a JSON field, not an indexed column — there's no uniqueness
   * constraint stopping two `create()` calls for the same webhook delivery. That gap is real: a
   * BullMQ job whose handler throws partway through retries automatically (the queue's own
   * `attempts: 3`), and without this check a retry would call `create()` again and produce a
   * second AgentTask for one webhook event. The job handler calls this first and reuses whatever
   * it finds instead of creating a duplicate.
   */
  async findByReceivedEventId(receivedEventId: string): Promise<AgentTaskRecord | null> {
    const row = await this.prisma.agentTask.findFirst({
      where: { trigger: { path: ["receivedEventId"], equals: receivedEventId } },
    });
    return row ? toRecord(row) : null;
  }

  /** Records `previousState` from whatever is currently persisted, so a PAUSED task can resume. */
  async updateState(id: string, state: TaskState): Promise<AgentTaskRecord> {
    const current = await this.prisma.agentTask.findUniqueOrThrow({ where: { id } });
    const row = await this.prisma.agentTask.update({
      where: { id },
      data: { state, previousState: current.state },
    });
    return toRecord(row);
  }

  async updatePlan(id: string, plan: Record<string, unknown>): Promise<AgentTaskRecord> {
    const row = await this.prisma.agentTask.update({
      where: { id },
      data: { plan: plan as Prisma.InputJsonValue },
    });
    return toRecord(row);
  }
}
