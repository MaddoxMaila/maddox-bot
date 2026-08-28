import { Prisma, type PrismaClient } from "@prisma/client";

export interface CreateTaskEventInput {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Append-only, UX-focused timeline (the VS Code task dashboard's data source) — deliberately
 * coarse-grained (state transitions, plan produced/failed), not one row per tool call. The
 * fine-grained per-call audit trail lives in ToolCallRepository/tool_results instead.
 */
export class TaskEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateTaskEventInput): Promise<TaskEventRecord> {
    return this.prisma.taskEvent.create({
      data: {
        taskId: input.taskId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  async listByTask(taskId: string): Promise<TaskEventRecord[]> {
    return this.prisma.taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  }
}
