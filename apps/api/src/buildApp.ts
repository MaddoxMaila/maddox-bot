import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";
import type { AppDependencies } from "./appDependencies.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerGitHubWebhookRoute } from "./routes/githubWebhook.js";
import { registerJiraWebhookRoute } from "./routes/jiraWebhook.js";
import { registerTaskStreamRoute } from "./routes/taskStream.js";
import { registerTaskRoutes } from "./routes/tasks.js";

export interface BuildAppOptions {
  /** Only ever overridden by tests, to avoid waiting on a multi-second real poll interval. */
  taskStreamPollIntervalMs?: number;
}

export async function buildApp(
  deps: AppDependencies,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  // Not wiring deps.logger in as Fastify's own HTTP logger: pino's Logger type and Fastify 5's
  // FastifyBaseLogger clash under exactOptionalPropertyTypes (childLoggerFactory/msgPrefix).
  // Routes log application-level events (duplicates, etc.) through deps.logger directly instead;
  // Fastify keeps its own default logger for HTTP-level concerns.
  const app = Fastify();

  // global: false + per-route `config.rawBody` (see githubWebhook.ts) — only the GitHub route
  // needs the exact raw bytes for HMAC verification; every other route just gets normal JSON
  // parsing untouched.
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  await app.register(fastifyWebsocket);

  registerGitHubWebhookRoute(app, deps);
  registerJiraWebhookRoute(app, deps);
  registerTaskRoutes(app, deps);
  registerApprovalRoutes(app, deps);
  registerTaskStreamRoute(app, deps, options.taskStreamPollIntervalMs);

  return app;
}
