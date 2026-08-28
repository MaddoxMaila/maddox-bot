import { Prisma, type PrismaClient } from "@prisma/client";

export interface ToolCallResultInput {
  ok: boolean;
  output?: unknown;
  error?: { code: string; message: string };
  durationMs: number;
}

export interface CreateCompletedToolCallInput {
  taskId: string;
  role: "planner" | "implementation_agent";
  toolName: string;
  input: Record<string, unknown>;
  /** The PermissionGate tier this call was classified at (see @maddox-bot/permissions), or
   * "not_classified" for a call that never reached classification (unknown tool, invalid input) —
   * see agent-core's AgentLoopRunner, the only writer of this table. */
  permissionDecision: string;
  result: ToolCallResultInput;
}

export interface ToolCallRecord {
  id: string;
  taskId: string;
  role: string;
  toolName: string;
  input: unknown;
  permissionDecision: string;
  startedAt: Date;
}

/**
 * Phase 1 never resolves a tool call asynchronously — ToolRegistry.execute() always awaits to
 * completion before agent-core learns about a call at all — so the ToolCall and its 1:1 ToolResult
 * are always written together. There is no "pending" state to model here.
 */
export class ToolCallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createCompleted(input: CreateCompletedToolCallInput): Promise<ToolCallRecord> {
    const { result } = input;
    return this.prisma.toolCall.create({
      data: {
        taskId: input.taskId,
        role: input.role,
        toolName: input.toolName,
        input: input.input as Prisma.InputJsonValue,
        permissionDecision: input.permissionDecision,
        result: {
          create: {
            ok: result.ok,
            durationMs: result.durationMs,
            ...(result.output !== undefined && { output: result.output as Prisma.InputJsonValue }),
            ...(result.error !== undefined && { error: result.error as Prisma.InputJsonValue }),
          },
        },
      },
      select: {
        id: true,
        taskId: true,
        role: true,
        toolName: true,
        input: true,
        permissionDecision: true,
        startedAt: true,
      },
    });
  }

  async listByTask(taskId: string): Promise<ToolCallRecord[]> {
    return this.prisma.toolCall.findMany({
      where: { taskId },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        taskId: true,
        role: true,
        toolName: true,
        input: true,
        permissionDecision: true,
        startedAt: true,
      },
    });
  }
}
