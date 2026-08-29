import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { createGitHubClient } from "@maddox-bot/github";
import { createJiraClient } from "@maddox-bot/jira";
import { createAnthropicProvider, ModelRouter } from "@maddox-bot/llm";
import { createId, createLogger } from "@maddox-bot/shared";
import type { TaskState } from "@maddox-bot/shared";
import { describe, expect, it } from "vitest";
import { handleAgentTriggerJob } from "./jobHandler.js";
import { requireTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

/**
 * Plan increment 17's own verification scenario, run against real services instead of fakes —
 * everything else in this repo's test suite either mocks GitHub/Jira/Anthropic or exercises them
 * against local infra (Postgres, Redis, Docker). This is the one place actually proving the
 * pipeline against the real internet. See tests/e2e/README.md for the one-time setup this needs
 * (a disposable GitHub repo seeded with tests/fixtures/sample-repo, a real Jira Cloud issue) and
 * exactly what each env var below means. Skips cleanly — not a failure — when they're unset, so
 * this file is always safe to leave in the normal `pnpm test` run.
 */
function readLiveCredentials() {
  const {
    ANTHROPIC_API_KEY,
    GITHUB_TOKEN,
    E2E_GITHUB_OWNER,
    E2E_GITHUB_REPO,
    JIRA_BASE_URL,
    JIRA_EMAIL,
    JIRA_API_TOKEN,
    E2E_JIRA_ISSUE_KEY,
  } = process.env;

  const values = {
    anthropicApiKey: ANTHROPIC_API_KEY,
    githubToken: GITHUB_TOKEN,
    githubOwner: E2E_GITHUB_OWNER,
    githubRepo: E2E_GITHUB_REPO,
    jiraBaseUrl: JIRA_BASE_URL,
    jiraEmail: JIRA_EMAIL,
    jiraApiToken: JIRA_API_TOKEN,
    jiraIssueKey: E2E_JIRA_ISSUE_KEY,
  };

  if (Object.values(values).some((value) => !value)) {
    return null;
  }
  return values as Record<keyof typeof values, string>;
}

const credentials = readLiveCredentials();

/**
 * The Implementation Agent's real fix-retry loop (TESTING <-> FIXING) runs zero or more times
 * depending on what the real model actually produces on its first attempt — unlike every other
 * test here, nothing scripts its behavior. This asserts the deterministic prefix and suffix around
 * that loop, and that nothing outside {TESTING, FIXING} appears inside it, rather than one exact
 * fixed sequence.
 */
function assertExpectedStateSequence(states: TaskState[]): void {
  const prefix: TaskState[] = [
    "CREATED",
    "ANALYZING",
    "PLANNED",
    "AWAITING_APPROVAL",
    "IMPLEMENTING",
    "TESTING",
  ];
  const suffix: TaskState[] = ["SELF_REVIEW", "PR_CREATED", "AWAITING_HUMAN_REVIEW"];

  expect(states.slice(0, prefix.length)).toEqual(prefix);
  expect(states.slice(states.length - suffix.length)).toEqual(suffix);

  const loop = states.slice(prefix.length, states.length - suffix.length);
  for (const state of loop) {
    expect(["TESTING", "FIXING"]).toContain(state);
  }
}

describe.skipIf(credentials === null)(
  "live pipeline end-to-end (plan increment 17's own verification scenario)",
  () => {
    it("takes a real Jira issue all the way to a real opened GitHub PR, with Jira linked", async () => {
      const live = credentials;
      if (!live) {
        throw new Error("unreachable: describe.skipIf already checked credentials");
      }

      const database = Database.forUrl(testDatabaseUrl());
      try {
        const org = await database.organizations.create({ name: `e2e-org-${createId()}` });
        const repository = await database.repositories.create({
          organizationId: org.id,
          owner: live.githubOwner,
          name: live.githubRepo,
          defaultBranch: "main",
          cloneUrl: `https://github.com/${live.githubOwner}/${live.githubRepo}.git`,
          agentTriggerConfig: {},
          branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
        });

        const deps: WorkerDependencies = {
          database,
          agentTriggerQueue: undefined as never, // handleAgentTriggerJob is called directly
          llm: createAnthropicProvider(live.anthropicApiKey),
          modelRouter: new ModelRouter(),
          githubToken: live.githubToken,
          githubClient: createGitHubClient(live.githubToken),
          jiraClient: createJiraClient({
            baseUrl: live.jiraBaseUrl,
            email: live.jiraEmail,
            apiToken: live.jiraApiToken,
          }),
          sandboxImage: process.env.SANDBOX_IMAGE ?? "maddox-bot-sandbox:latest",
          gitIdentity: { name: "maddox-bot-e2e", email: "e2e@maddox-bot.local" },
          autoApprovePlans: true,
          logger: createLogger("worker-live-e2e-test"),
        };

        const receivedEventId = createId();
        await handleAgentTriggerJob(deps, {
          source: "jira",
          repositoryId: repository.id,
          eventType: "e2e.manual_trigger",
          externalRefs: { issueKey: live.jiraIssueKey },
          receivedEventId,
        });

        const task = await database.agentTasks.findByReceivedEventId(receivedEventId);
        expect(task).not.toBeNull();
        const finalTask = await requireTask(deps, task?.id ?? "");

        expect(finalTask.state).toBe("AWAITING_HUMAN_REVIEW");

        const events = await database.taskEvents.listByTask(finalTask.id);
        const stateSequence = events
          .filter((event) => event.type === "state_changed")
          .map((event) => (event.payload as { to: TaskState }).to);
        assertExpectedStateSequence(stateSequence);

        const pr = await database.pullRequests.findByTaskId(finalTask.id);
        expect(pr).not.toBeNull();
        expect(pr?.url).toContain(`github.com/${live.githubOwner}/${live.githubRepo}/pull/`);

        const comments = await deps.jiraClient.getComments(live.jiraIssueKey);
        expect(comments.some((comment) => comment.body.includes(pr?.url ?? ""))).toBe(true);
      } finally {
        await database.disconnect();
      }
    }, 600000);
  },
);
