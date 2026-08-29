import { Database } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import { BullMqJobQueue } from "@maddox-bot/queue";
import { createLogger, requireEnv } from "@maddox-bot/shared";
import { buildApp } from "./buildApp.js";

const logger = createLogger("api");

async function main(): Promise<void> {
  const database = new Database();
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
  // Same queue names as apps/worker's consumer side — BullMQ queues are identified by name in Redis.
  const agentTriggerQueue = new BullMqJobQueue<AgentTriggerJobPayload>("agent-triggers", {
    redisUrl,
  });
  const taskResumeQueue = new BullMqJobQueue<TaskResumeJobPayload>("task-resume", { redisUrl });

  const app = await buildApp({
    database,
    agentTriggerQueue,
    taskResumeQueue,
    githubWebhookSecret: requireEnv("GITHUB_WEBHOOK_SECRET"),
    jiraWebhookSecret: requireEnv("JIRA_WEBHOOK_SECRET"),
    logger,
  });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "API failed to start");
  process.exit(1);
}
