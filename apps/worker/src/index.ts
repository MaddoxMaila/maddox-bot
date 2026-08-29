import { Database } from "@maddox-bot/database";
import type { AgentTriggerJobPayload, TaskResumeJobPayload } from "@maddox-bot/events";
import { createGitHubClient } from "@maddox-bot/github";
import { createJiraClient } from "@maddox-bot/jira";
import { createAnthropicProvider, ModelRouter } from "@maddox-bot/llm";
import { BullMqJobQueue } from "@maddox-bot/queue";
import { createLogger, requireEnv } from "@maddox-bot/shared";
import { handleAgentTriggerJob } from "./jobHandler.js";
import { recoverStuckTasksOnStartup } from "./startupRecovery.js";
import { runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

const logger = createLogger("worker");

async function main(): Promise<void> {
  const githubToken = requireEnv("GITHUB_TOKEN");
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

  const deps: WorkerDependencies = {
    database: new Database(),
    // Same queue name as apps/api's producer — BullMQ queues are identified by name in Redis.
    agentTriggerQueue: new BullMqJobQueue<AgentTriggerJobPayload>("agent-triggers", { redisUrl }),
    llm: createAnthropicProvider(requireEnv("ANTHROPIC_API_KEY")),
    modelRouter: new ModelRouter(),
    githubToken,
    githubClient: createGitHubClient(githubToken),
    jiraClient: createJiraClient({
      baseUrl: requireEnv("JIRA_BASE_URL"),
      email: requireEnv("JIRA_EMAIL"),
      apiToken: requireEnv("JIRA_API_TOKEN"),
    }),
    sandboxImage: process.env.SANDBOX_IMAGE ?? "maddox-bot-sandbox:latest",
    gitIdentity: {
      name: process.env.GIT_BOT_NAME ?? "maddox-bot",
      email: process.env.GIT_BOT_EMAIL ?? "bot@maddox-bot.local",
    },
    autoApprovePlans: process.env.WORKER_AUTO_APPROVE_PLANS !== "false",
    logger,
  };

  await recoverStuckTasksOnStartup(deps);

  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1);
  deps.agentTriggerQueue.process(
    async (payload) => {
      await handleAgentTriggerJob(deps, payload);
    },
    { concurrency },
  );

  // Separate from agentTriggerQueue: only apps/api's approval endpoint ever enqueues onto this
  // one, as a nudge to re-check a task after a human decides an approval — never read elsewhere in
  // this package, so it isn't part of WorkerDependencies.
  const taskResumeQueue = new BullMqJobQueue<TaskResumeJobPayload>("task-resume", { redisUrl });
  taskResumeQueue.process(
    async (payload) => {
      await runTask(deps, payload.taskId);
    },
    { concurrency },
  );

  logger.info({ concurrency }, "worker started, processing agent-triggers and task-resume queues");
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "worker failed to start");
  process.exit(1);
}
