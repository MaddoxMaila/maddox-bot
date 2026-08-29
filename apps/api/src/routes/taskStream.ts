import type { TaskEventRecord } from "@maddox-bot/database";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;

interface UpdateMessage {
  type: "update";
  state: string;
  newEvents: TaskEventRecord[];
}

interface ErrorMessage {
  type: "error";
  message: string;
}

/**
 * Polling behind a WebSocket, not Redis pub/sub from the worker: the worker is a separate process
 * writing task_events directly to Postgres, and wiring a publish call into every one of agent-core's
 * scattered task_event write sites (TaskStateMachine, AgentLoopRunner, ImplementationAgentRunner, ...)
 * is a cross-cutting concern that's easy to miss at a new call site later. A short poll keeps this
 * package, agent-core, and the database layer completely unaware of who's listening, at the cost of
 * up to one poll interval of latency — imperceptible for a human watching a task's progress. Redis
 * pub/sub (already a dependency, for BullMQ) is the natural upgrade path if that latency ever
 * actually matters.
 *
 * `pollIntervalMs` is a parameter (not a hardcoded constant) purely so tests can use a short one.
 */
export function registerTaskStreamRoute(
  app: FastifyInstance,
  deps: AppDependencies,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): void {
  app.get<{ Params: { id: string } }>(
    "/tasks/:id/stream",
    { websocket: true },
    (socket, request) => {
      const { id: taskId } = request.params;
      let lastEventCreatedAt: Date | null = null;
      let lastState: string | null = null;
      let closed = false;

      async function poll(): Promise<void> {
        if (closed) {
          return;
        }
        try {
          const task = await deps.database.agentTasks.findById(taskId);
          if (!task) {
            const message: ErrorMessage = { type: "error", message: "task not found" };
            socket.send(JSON.stringify(message));
            socket.close();
            return;
          }

          const allEvents = await deps.database.taskEvents.listByTask(taskId);
          const newEvents = lastEventCreatedAt
            ? allEvents.filter((event) => event.createdAt > (lastEventCreatedAt as Date))
            : allEvents;

          if (newEvents.length > 0 || task.state !== lastState) {
            const message: UpdateMessage = { type: "update", state: task.state, newEvents };
            socket.send(JSON.stringify(message));
          }

          const latestEvent = allEvents.at(-1);
          if (latestEvent) {
            lastEventCreatedAt = latestEvent.createdAt;
          }
          lastState = task.state;
        } catch (error) {
          deps.logger.error({ err: error, taskId }, "task stream poll failed");
        }
      }

      void poll();
      const interval = setInterval(() => void poll(), pollIntervalMs);

      socket.on("close", () => {
        closed = true;
        clearInterval(interval);
      });
    },
  );
}
