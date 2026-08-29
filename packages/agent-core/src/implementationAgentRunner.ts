import type { ToolExecutionContext, ToolRegistry } from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";
import type { ConversationMessage, LLMProvider } from "@maddox-bot/llm";
import { AgentLoopRunner, type AgentLoopOptions } from "./agentLoopRunner.js";
import { buildImplementationContext, type ImplementationJiraContext } from "./contextBuilder.js";
import type { ImplementationPlan } from "./implementationPlan.js";
import { buildPullRequestBody, buildPullRequestTitle } from "./pullRequestTemplate.js";
import { selfReviewSchema, type SelfReview } from "./selfReview.js";
import { TaskStateMachine } from "./taskStateMachine.js";
import { executeAndRecordTool } from "./toolExecution.js";

const DEFAULT_MAX_FIX_ATTEMPTS = 3;
const VERIFICATION_TOOLS = [
  "shell.run_build",
  "shell.run_lint",
  "shell.run_typecheck",
  "shell.run_tests",
] as const;

export interface ImplementationAgentDeps {
  llm: LLMProvider;
  model: string;
  /** Already populated with the Implementation Agent's full toolset (repo read+write, git
   * read+write, shell run, github/jira write) — assembling that from real clients is the worker's
   * job (increment 14), same division of responsibility as PlannerRunner. */
  toolRegistry: ToolRegistry;
  database: Database;
  requestApproval: (summary: string) => Promise<"approved" | "denied">;
  maxToolCalls?: number;
  maxDurationMs?: number;
  /** Fix-retry budget before giving up and moving to BLOCKED (approved plan, section 6: "3 fix-
   * retries before BLOCKED"). */
  maxFixAttempts?: number;
}

export interface ImplementationAgentRepository {
  id: string;
  owner: string;
  name: string;
}

export interface ImplementationAgentInput {
  taskId: string;
  workspaceId: string;
  plan: ImplementationPlan;
  jiraIssue: ImplementationJiraContext;
  repository: ImplementationAgentRepository;
  baseBranch: string;
  /** Computed by the caller from repositories.branch_naming_template — templating that policy
   * isn't this package's concern (see PlannerContextInput's own pre-fetched-data convention). */
  branchName: string;
  /** Jira status name to transition the issue to once the PR opens (e.g. "In Review") — workflow-
   * specific, so this package never assumes one. Omit to skip the transition. */
  targetReviewStatus?: string;
}

export interface CreatedPullRequest {
  number: number;
  url: string;
}

export interface ImplementationAgentResult {
  stopReason: "completed" | "blocked";
  pullRequest: CreatedPullRequest | null;
  fixAttempts: number;
}

interface ShellCheckOutput {
  skipped: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

interface GateResult {
  passed: boolean;
  failureSummary: string;
}

interface CreatePullRequestOutput {
  number: number;
  url: string;
}

/**
 * The Implementation Agent: AWAITING_APPROVAL -> IMPLEMENTING -> TESTING <-> FIXING -> SELF_REVIEW
 * -> PR_CREATED -> AWAITING_HUMAN_REVIEW (approved plan, section 4 and 6).
 *
 * Only *writing the code* and *fixing test failures* are LLM-driven (via AgentLoopRunner, sharing
 * the same manual tool-use loop the Planner uses). Everything else — running the verification
 * suite, pushing, opening the PR with a well-defined template, linking Jira — is deterministic code
 * in this class, not something left to the model's judgement to remember to do correctly. Every
 * step, LLM-driven or programmatic, still goes through the same toolRegistry + executeAndRecordTool
 * path, so the tool_calls audit trail covers the whole run uniformly.
 */
export class ImplementationAgentRunner {
  private readonly stateMachine: TaskStateMachine;
  private readonly loopRunner: AgentLoopRunner;

  constructor(private readonly deps: ImplementationAgentDeps) {
    this.stateMachine = new TaskStateMachine(deps.database);
    this.loopRunner = new AgentLoopRunner(deps.llm, deps.toolRegistry, deps.database);
  }

  async run(input: ImplementationAgentInput): Promise<ImplementationAgentResult> {
    const task = { id: input.taskId, workspaceId: input.workspaceId };
    const ctx: ToolExecutionContext = {
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      role: "implementation_agent",
      requestApproval: this.deps.requestApproval,
    };

    await this.stateMachine.transition(input.taskId, "AWAITING_APPROVAL", "IMPLEMENTING");

    const branchOutcome = await this.callTool(input.taskId, ctx, "git.create_branch", {
      name: input.branchName,
      from: input.baseBranch,
    });
    if (!branchOutcome.ok) {
      return this.blocked(input.taskId, "IMPLEMENTING", "branch_creation_failed", 0, {
        message: branchOutcome.error?.message,
      });
    }

    const { system, messages: initialMessages } = buildImplementationContext({
      plan: input.plan,
      jiraIssue: input.jiraIssue,
    });
    const loopOptions = this.buildLoopOptions(system);

    let loopResult = await this.loopRunner.run(task, loopOptions, initialMessages);
    if (loopResult.stopReason !== "completed") {
      return this.blocked(input.taskId, "IMPLEMENTING", "implementation_incomplete", 0, {
        stopReason: loopResult.stopReason,
        toolCallCount: loopResult.toolCallCount,
      });
    }

    await this.stateMachine.transition(input.taskId, "IMPLEMENTING", "TESTING");

    const maxFixAttempts = this.deps.maxFixAttempts ?? DEFAULT_MAX_FIX_ATTEMPTS;
    let fixAttempts = 0;
    let gate = await this.runVerificationGate(input.taskId, ctx);

    while (!gate.passed) {
      if (fixAttempts >= maxFixAttempts) {
        return this.blocked(input.taskId, "TESTING", "fix_attempts_exhausted", fixAttempts, {
          failureSummary: gate.failureSummary,
        });
      }
      fixAttempts++;

      await this.stateMachine.transition(input.taskId, "TESTING", "FIXING");

      const fixMessages: ConversationMessage[] = [
        ...loopResult.messages,
        {
          role: "user",
          content: `The verification gate failed:\n\n${gate.failureSummary}\n\nFix the issue(s), then commit and push again.`,
        },
      ];
      loopResult = await this.loopRunner.run(task, loopOptions, fixMessages);
      if (loopResult.stopReason !== "completed") {
        return this.blocked(input.taskId, "FIXING", "fix_attempt_incomplete", fixAttempts, {
          stopReason: loopResult.stopReason,
        });
      }

      await this.stateMachine.transition(input.taskId, "FIXING", "TESTING");
      gate = await this.runVerificationGate(input.taskId, ctx);
    }

    await this.stateMachine.transition(input.taskId, "TESTING", "SELF_REVIEW");

    const diffOutcome = await this.callTool(input.taskId, ctx, "git.diff", {
      base: input.baseBranch,
    });
    const diff = diffOutcome.ok ? ((diffOutcome.output as string | undefined) ?? "") : "";
    const selfReview = await this.performSelfReview(input.plan, diff);

    const pushOutcome = await this.callTool(input.taskId, ctx, "git.push", {
      branch: input.branchName,
    });
    if (!pushOutcome.ok) {
      return this.blocked(input.taskId, "SELF_REVIEW", "push_failed", fixAttempts, {
        message: pushOutcome.error?.message,
      });
    }

    const title = buildPullRequestTitle(input.jiraIssue, input.plan);
    const body = buildPullRequestBody(input.jiraIssue, input.plan, selfReview);
    const prOutcome = await this.callTool(input.taskId, ctx, "github.create_pr", {
      owner: input.repository.owner,
      repo: input.repository.name,
      title,
      body,
      head: input.branchName,
      base: input.baseBranch,
    });
    if (!prOutcome.ok) {
      return this.blocked(input.taskId, "SELF_REVIEW", "pr_creation_failed", fixAttempts, {
        message: prOutcome.error?.message,
      });
    }

    const pr = prOutcome.output as CreatePullRequestOutput;
    await this.deps.database.pullRequests.create({
      taskId: input.taskId,
      repositoryId: input.repository.id,
      providerPrNumber: pr.number,
      url: pr.url,
      title,
      body,
      headBranch: input.branchName,
      baseBranch: input.baseBranch,
    });

    // A failure here doesn't erase the PR that already exists — it's recorded, not fatal.
    await this.linkJiraBestEffort(
      input.taskId,
      ctx,
      input.jiraIssue.key,
      pr,
      title,
      input.targetReviewStatus,
    );

    await this.stateMachine.transition(input.taskId, "SELF_REVIEW", "PR_CREATED");
    await this.deps.database.taskEvents.create({
      taskId: input.taskId,
      type: "pull_request_created",
      payload: { number: pr.number, url: pr.url },
    });
    await this.stateMachine.transition(input.taskId, "PR_CREATED", "AWAITING_HUMAN_REVIEW");

    return {
      stopReason: "completed",
      pullRequest: { number: pr.number, url: pr.url },
      fixAttempts,
    };
  }

  private buildLoopOptions(system: string): AgentLoopOptions<void> {
    return {
      role: "implementation_agent",
      system,
      tools: this.deps.toolRegistry.list(),
      model: this.deps.model,
      ...(this.deps.maxToolCalls !== undefined && { maxToolCalls: this.deps.maxToolCalls }),
      ...(this.deps.maxDurationMs !== undefined && { maxDurationMs: this.deps.maxDurationMs }),
      requestApproval: this.deps.requestApproval,
    };
  }

  private async callTool(
    taskId: string,
    ctx: ToolExecutionContext,
    toolName: string,
    input: unknown,
  ) {
    return executeAndRecordTool(
      this.deps.database,
      this.deps.toolRegistry,
      taskId,
      "implementation_agent",
      toolName,
      input,
      ctx,
    );
  }

  private async runVerificationGate(
    taskId: string,
    ctx: ToolExecutionContext,
  ): Promise<GateResult> {
    const failures: string[] = [];

    for (const toolName of VERIFICATION_TOOLS) {
      const outcome = await this.callTool(taskId, ctx, toolName, {});
      if (!outcome.ok) {
        failures.push(`${toolName}: tool error — ${outcome.error?.message ?? "unknown error"}`);
        continue;
      }
      const output = outcome.output as ShellCheckOutput;
      if (!output.skipped && output.exitCode !== 0) {
        const combinedOutput = `${output.stdout ?? ""}${output.stderr ?? ""}`.trim();
        failures.push(`${toolName} failed (exit ${output.exitCode}):\n${combinedOutput}`);
      }
    }

    return { passed: failures.length === 0, failureSummary: failures.join("\n\n") };
  }

  private async performSelfReview(plan: ImplementationPlan, diff: string): Promise<SelfReview> {
    const result = await this.deps.llm.structuredOutput({
      model: this.deps.model,
      system:
        "You are performing a lightweight self-review of a diff about to be opened as a pull " +
        "request. Note anything worth a human reviewer's attention, but do not block on stylistic " +
        "nitpicks. Be concise.",
      messages: [
        {
          role: "user",
          content: `Plan summary: ${plan.summary}\n\nDiff:\n${diff || "(no diff — nothing changed)"}`,
        },
      ],
      schemaName: "SelfReview",
      schema: selfReviewSchema,
    });
    return (
      result.value ?? { summary: "Self-review did not produce a structured result.", concerns: [] }
    );
  }

  private async linkJiraBestEffort(
    taskId: string,
    ctx: ToolExecutionContext,
    issueKey: string,
    pr: CreatePullRequestOutput,
    prTitle: string,
    targetReviewStatus: string | undefined,
  ): Promise<void> {
    const linkOutcome = await this.callTool(taskId, ctx, "jira.link_pr", {
      issueKey,
      prUrl: pr.url,
      prTitle,
    });
    if (!linkOutcome.ok) {
      await this.deps.database.taskEvents.create({
        taskId,
        type: "jira_link_failed",
        payload: { message: linkOutcome.error?.message },
      });
    }

    if (targetReviewStatus === undefined) {
      return;
    }
    const transitionOutcome = await this.callTool(taskId, ctx, "jira.update_issue", {
      issueKey,
      status: targetReviewStatus,
    });
    if (!transitionOutcome.ok) {
      await this.deps.database.taskEvents.create({
        taskId,
        type: "jira_transition_failed",
        payload: { message: transitionOutcome.error?.message, targetReviewStatus },
      });
    }
  }

  private async blocked(
    taskId: string,
    from: Parameters<TaskStateMachine["transition"]>[1],
    reason: string,
    fixAttempts: number,
    metadata: Record<string, unknown>,
  ): Promise<ImplementationAgentResult> {
    await this.deps.database.taskEvents.create({ taskId, type: reason, payload: metadata });
    await this.stateMachine.transition(taskId, from, "BLOCKED");
    return { stopReason: "blocked", pullRequest: null, fixAttempts };
  }
}
