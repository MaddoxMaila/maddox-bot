import type { ConversationMessage } from "@maddox-bot/llm";

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
