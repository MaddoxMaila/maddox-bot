import { canTransition, TaskStateMachine } from "@maddox-bot/agent-core";
import { createId } from "@maddox-bot/shared";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

/**
 * `GET /tasks` requires `repositoryId` rather than listing across the whole system — Phase 1's
 * only client (a VS Code extension working in one open repository) never needs a cross-repository
 * view, and `AgentTaskRepository` has no such query yet either.
 */
export function registerTaskRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const stateMachine = new TaskStateMachine(deps.database);

  app.get<{ Querystring: { repositoryId?: string } }>("/tasks", async (request, reply) => {
    const { repositoryId } = request.query;
    if (!repositoryId) {
      return reply.code(400).send({ error: "repositoryId query parameter is required" });
    }
    const tasks = await deps.database.agentTasks.listByRepository(repositoryId);
    return reply.send({ tasks });
  });

  /**
   * The VS Code extension's "implement <ISSUE-KEY>" command (plan section 3's "direct trigger").
   * Deliberately doesn't create the AgentTask itself: fetching the issue and resolving it into a
   * task is apps/worker's job for every other trigger source too (see jobHandler.ts) — this route
   * just enqueues the exact same AgentTriggerJobPayload a Jira webhook would, tagged
   * `source: "direct"`, so it converges on identical worker-side handling rather than a parallel
   * implementation. `receivedEventId` is generated here (not persisted to `received_events`, which
   * is specifically an inbound-webhook audit trail) purely so a retried job attempt (BullMQ's own
   * `attempts: 3`) can still be recognized as "already produced a task" via
   * `AgentTaskRepository.findByReceivedEventId` — the same mechanism a webhook-sourced job relies
   * on, working here for the same reason.
   */
  app.post<{ Body: { repositoryId?: string; issueKey?: string } }>(
    "/tasks",
    async (request, reply) => {
      const { repositoryId, issueKey } = request.body ?? {};
      if (!repositoryId || !issueKey) {
        return reply.code(400).send({ error: "repositoryId and issueKey are required" });
      }
      const repository = await deps.database.repositories.findById(repositoryId);
      if (!repository) {
        return reply.code(404).send({ error: "repository not found" });
      }

      const receivedEventId = createId();
      await deps.agentTriggerQueue.enqueue({
        source: "direct",
        repositoryId: repository.id,
        eventType: "direct.implement_issue",
        externalRefs: { issueKey },
        receivedEventId,
      });

      return reply.code(202).send({ receivedEventId });
    },
  );

  /**
   * Lets a client poll for the task a `POST /tasks` call eventually produces — task creation
   * happens asynchronously in the worker, so the enqueueing call above can't return a task id
   * directly.
   */
  app.get<{ Params: { receivedEventId: string } }>(
    "/tasks/by-received-event/:receivedEventId",
    async (request, reply) => {
      const task = await deps.database.agentTasks.findByReceivedEventId(
        request.params.receivedEventId,
      );
      return reply.send({ task });
    },
  );

  app.get<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    return reply.send({ task });
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/events", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    const events = await deps.database.taskEvents.listByTask(request.params.id);
    return reply.send({ events });
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/tool-calls", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    const toolCalls = await deps.database.toolCalls.listByTask(request.params.id);
    return reply.send({ toolCalls });
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/approvals", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    const approvals = await deps.database.approvals.listByTask(request.params.id);
    return reply.send({ approvals });
  });

  /**
   * The PR is the only durable record of "what changed" — no diff is ever persisted (the sandbox
   * that produced it is ephemeral, see packages/sandbox's README) — so this is what a "show diff"
   * chat command in the VS Code extension actually resolves to: the linked PR's URL, or null
   * before one exists yet.
   */
  app.get<{ Params: { id: string } }>("/tasks/:id/pull-request", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    const pullRequest = await deps.database.pullRequests.findByTaskId(request.params.id);
    return reply.send({ pullRequest });
  });

  /**
   * Reuses agent-core's own TaskStateMachine rather than writing state-transition/audit logic a
   * second time — CANCELLED is reachable from any non-terminal state (canTransition() checked
   * up front so this 409s cleanly instead of throwing agent-core's generic "illegal transition"
   * Error, which isn't a typed error class worth instanceof-matching for just this one call site).
   * This only marks the row; a worker actively mid-loop on this task won't notice until its next
   * dispatch (see apps/worker's README — there's no signal reaching a running phase yet).
   */
  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (request, reply) => {
    const task = await deps.database.agentTasks.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "task not found" });
    }
    if (!canTransition(task.state, "CANCELLED")) {
      return reply.code(409).send({ error: `task is already in a terminal state (${task.state})` });
    }
    await stateMachine.transition(task.id, task.state, "CANCELLED", {
      reason: "cancelled_by_user",
    });
    return reply.send({ task: await deps.database.agentTasks.findById(task.id) });
  });
}
