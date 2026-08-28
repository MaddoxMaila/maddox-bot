import { Prisma, type PrismaClient } from "@prisma/client";

export interface CreateReceivedEventInput {
  source: "github" | "jira";
  sourceEventId: string;
  eventType: string;
  organizationId?: string;
  repositoryId?: string;
  isRelevant: boolean;
  relevanceReason: string;
  payload: Record<string, unknown>;
}

export interface ReceivedEventRecord {
  id: string;
  source: string;
  sourceEventId: string;
  eventType: string;
  organizationId: string | null;
  repositoryId: string | null;
  isRelevant: boolean;
  relevanceReason: string;
  receivedAt: Date;
}

export class ReceivedEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns null instead of throwing when (source, sourceEventId) already exists — this is the
   * durability half of the pipeline's dedupe: a duplicate delivery is a no-op, not an error.
   */
  async createIfNew(input: CreateReceivedEventInput): Promise<ReceivedEventRecord | null> {
    try {
      return await this.prisma.receivedEvent.create({
        data: {
          source: input.source,
          sourceEventId: input.sourceEventId,
          eventType: input.eventType,
          ...(input.organizationId !== undefined && { organizationId: input.organizationId }),
          ...(input.repositoryId !== undefined && { repositoryId: input.repositoryId }),
          isRelevant: input.isRelevant,
          relevanceReason: input.relevanceReason,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return null;
      }
      throw error;
    }
  }
}
