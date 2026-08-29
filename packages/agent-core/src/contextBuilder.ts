import type { ConversationMessage } from "@maddox-bot/llm";
import type { ImplementationPlan } from "./implementationPlan.js";

export interface JiraIssueContext {
  key: string;
  summary: string;
  description: string;
  status: string;
  acceptanceCriteria?: string[];
}

export interface RepositoryContext {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface PlannerContextInput {
  jiraIssue: JiraIssueContext;
  repository: RepositoryContext;
  /** Free-text repo conventions (e.g. a CONTRIBUTING.md/CLAUDE.md excerpt), if the caller has one. */
  conventions?: string;
}

export interface BuiltContext {
  system: string;
  messages: ConversationMessage[];
}

/**
 * Pure and synchronous by design: fetching the Jira issue, reading a repo's conventions file, and
 * loading prior messages when resuming a session are all I/O the caller (the worker) does before
 * calling this — keeping context assembly itself trivially testable without mocking a network.
 */
export function buildPlannerContext(input: PlannerContextInput): BuiltContext {
  const { jiraIssue, repository, conventions } = input;

  const acceptanceCriteria =
    jiraIssue.acceptanceCriteria && jiraIssue.acceptanceCriteria.length > 0
      ? `\nAcceptance criteria:\n${jiraIssue.acceptanceCriteria.map((line) => `- ${line}`).join("\n")}`
      : "";
  const conventionsBlock = conventions ? `\n\nRepository conventions:\n${conventions}` : "";

  const system = `You are the Planning agent for an autonomous software engineering system. Given a \
Jira issue and read-only access to the target repository, investigate the codebase using the tools \
available to you and produce an implementation plan. You do not write or modify any code yourself — \
that is the Implementation Agent's job, working from the plan you produce.

Explore only as much as you need to propose a concrete, actionable plan. Once you stop calling \
tools, you will be asked to produce a final structured plan.

Jira issue: ${jiraIssue.key} — ${jiraIssue.summary}
Status: ${jiraIssue.status}
Description:
${jiraIssue.description}${acceptanceCriteria}

Repository: ${repository.owner}/${repository.name} (default branch: ${repository.defaultBranch})${conventionsBlock}`;

  const messages: ConversationMessage[] = [
    { role: "user", content: "Begin your investigation and propose an implementation plan." },
  ];

  return { system, messages };
}

export interface ImplementationJiraContext {
  key: string;
  summary: string;
}

export interface ImplementationContextInput {
  plan: ImplementationPlan;
  jiraIssue: ImplementationJiraContext;
}

function planFileList(files: ImplementationPlan["filesToCreate"]): string {
  return files.length > 0
    ? files.map((file) => `- ${file.path} — ${file.reason}`).join("\n")
    : "(none)";
}

/**
 * The Implementation Agent's context is deliberately the Planner's *structured* plan plus a
 * compact Jira summary — not the Planner's raw exploration transcript (keep context lean, spec
 * §28). Pure and synchronous for the same reason buildPlannerContext() is: the caller assembles
 * any I/O-backed data first.
 */
export function buildImplementationContext(input: ImplementationContextInput): BuiltContext {
  const { plan, jiraIssue } = input;

  const requiredTests =
    plan.requiredTests.length > 0
      ? plan.requiredTests.map((test) => `- ${test}`).join("\n")
      : "(none)";
  const risksList = plan.risks.map((risk) => `- ${risk}`).join("\n");
  const risksBlock = plan.risks.length > 0 ? `\nKnown risks:\n${risksList}` : "";

  const system = `You are the Implementation Agent for an autonomous software engineering system. \
You have been given an approved implementation plan; your job is to carry it out using your \
read/write tools: write the code, add or update tests, and commit your work. Push once you're done.

A separate, deterministic verification step runs the project's build/lint/typecheck/test scripts \
after you stop calling tools — if it finds problems, you will be given the failure output in a \
follow-up message and asked to fix them, so you do not need to guess whether your work is complete \
before stopping.

Jira issue: ${jiraIssue.key} — ${jiraIssue.summary}

Plan summary: ${plan.summary}
Approach: ${plan.approach}

Files to create:
${planFileList(plan.filesToCreate)}

Files to modify:
${planFileList(plan.filesToModify)}

Required tests:
${requiredTests}${risksBlock}`;

  const messages: ConversationMessage[] = [
    {
      role: "user",
      content:
        "Implement the plan now. Write the code, add or update the required tests, then commit and push your work.",
    },
  ];

  return { system, messages };
}
