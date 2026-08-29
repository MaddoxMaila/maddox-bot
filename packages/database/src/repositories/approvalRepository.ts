import type { PrismaClient } from "@prisma/client";

/**
 * Distinct classes, not string-matched Error messages: Prisma's own thrown errors render a
 * source-code context snippet around the failing call, which can easily *contain* an unrelated
 * substring a naive `message.includes(...)` check would false-positive on (e.g. a nearby line of
 * this very file's own error text). A caller distinguishing failure modes needs `instanceof`, not
 * text matching.
 */
export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`No such approval: ${id}`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(id: string, status: string) {
    super(`Approval ${id} was already decided (${status})`);
    this.name = "ApprovalAlreadyDecidedError";
  }
}

export type ApprovalKind = "plan_approval" | "tool_approval";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalDecision = "approved" | "denied";

export interface CreateApprovalInput {
  taskId: string;
  kind: ApprovalKind;
  summary: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  kind: string;
  summary: string;
  status: string;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const SELECT_FIELDS = {
  id: true,
  taskId: true,
  kind: true,
  summary: true,
  status: true,
  decidedById: true,
  decidedAt: true,
  createdAt: true,
} as const;

/**
 * Only `plan_approval` has a real writer yet (apps/worker's taskRunner.ts, when a task reaches
 * AWAITING_APPROVAL) — `tool_approval` rows aren't created anywhere; approval-required tool calls
 * still resolve through the worker's denyWithoutHuman() safe-default instead. The schema and this
 * repository stay general across both kinds rather than hard-coding the one that's wired so far.
 */
export class ApprovalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateApprovalInput): Promise<ApprovalRecord> {
    return this.prisma.approval.create({
      data: { taskId: input.taskId, kind: input.kind, summary: input.summary },
      select: SELECT_FIELDS,
    });
  }

  async findById(id: string): Promise<ApprovalRecord | null> {
    return this.prisma.approval.findUnique({ where: { id }, select: SELECT_FIELDS });
  }

  async listByTask(taskId: string): Promise<ApprovalRecord[]> {
    return this.prisma.approval.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      select: SELECT_FIELDS,
    });
  }

  async listPending(): Promise<ApprovalRecord[]> {
    return this.prisma.approval.findMany({
      where: { status: "pending" satisfies ApprovalStatus },
      orderBy: { createdAt: "asc" },
      select: SELECT_FIELDS,
    });
  }

  /** Throws if the approval no longer exists or was already decided — a stale or duplicate
   * decide request should fail loudly, not silently overwrite a real decision. */
  async decide(
    id: string,
    decision: ApprovalDecision,
    decidedById?: string,
  ): Promise<ApprovalRecord> {
    const current = await this.prisma.approval.findUnique({ where: { id } });
    if (!current) {
      throw new ApprovalNotFoundError(id);
    }
    if (current.status !== "pending") {
      throw new ApprovalAlreadyDecidedError(id, current.status);
    }
    return this.prisma.approval.update({
      where: { id },
      data: {
        status: decision satisfies ApprovalStatus,
        decidedAt: new Date(),
        ...(decidedById !== undefined && { decidedById }),
      },
      select: SELECT_FIELDS,
    });
  }
}
