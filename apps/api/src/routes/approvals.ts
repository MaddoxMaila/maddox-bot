import {
  ApprovalAlreadyDecidedError,
  ApprovalNotFoundError,
  type ApprovalDecision,
} from "@maddox-bot/database";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

interface DecideBody {
  decision?: unknown;
  decidedBy?: unknown;
}

function parseDecision(body: DecideBody): ApprovalDecision | null {
  return body.decision === "approved" || body.decision === "denied" ? body.decision : null;
}

/**
 * Deciding an approval only ever *records the decision and nudges the worker* — it never runs
 * agent-core itself. What happens next (implement, or cancel on a denial) is entirely
 * taskRunner.ts's dispatch logic, the same code path a crash-recovery or a fresh task goes
 * through; this route doesn't special-case it.
 */
export function registerApprovalRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get("/approvals", async (_request, reply) => {
    const approvals = await deps.database.approvals.listPending();
    return reply.send({ approvals });
  });

  app.post<{ Params: { id: string }; Body: DecideBody }>(
    "/approvals/:id/decide",
    async (request, reply) => {
      const decision = parseDecision(request.body ?? {});
      if (!decision) {
        return reply.code(400).send({ error: 'decision must be "approved" or "denied"' });
      }
      const decidedBy =
        typeof request.body?.decidedBy === "string" ? request.body.decidedBy : undefined;

      let decided;
      try {
        decided = await deps.database.approvals.decide(request.params.id, decision, decidedBy);
      } catch (error) {
        if (error instanceof ApprovalNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof ApprovalAlreadyDecidedError) {
          return reply.code(409).send({ error: error.message });
        }
        // Anything else (e.g. a malformed decidedBy that isn't a real user id) is a genuine
        // unexpected failure, not a business-logic conflict — let it surface as a 500 rather than
        // being misreported as "already decided".
        throw error;
      }

      await deps.taskResumeQueue.enqueue({ taskId: decided.taskId });

      return reply.send({ approval: decided });
    },
  );
}
