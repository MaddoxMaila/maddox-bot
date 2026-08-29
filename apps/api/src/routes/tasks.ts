import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

/**
 * `GET /tasks` requires `repositoryId` rather than listing across the whole system — Phase 1's
 * only client (a VS Code extension working in one open repository) never needs a cross-repository
 * view, and `AgentTaskRepository` has no such query yet either.
 */
export function registerTaskRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get<{ Querystring: { repositoryId?: string } }>("/tasks", async (request, reply) => {
    const { repositoryId } = request.query;
    if (!repositoryId) {
      return reply.code(400).send({ error: "repositoryId query parameter is required" });
    }
    const tasks = await deps.database.agentTasks.listByRepository(repositoryId);
    return reply.send({ tasks });
  });

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
}
