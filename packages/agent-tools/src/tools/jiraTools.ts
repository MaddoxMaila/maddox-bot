import type { JiraClient } from "@maddox-bot/jira";
import { z } from "zod";
import type { ToolDefinition } from "../toolDefinition.js";

const issueKeySchema = z.object({ issueKey: z.string() });

/** Read tools since increment 11 — createJiraWriteTools() below adds update_issue/add_comment/
 * link_pr (increment 13). */
export function createJiraReadTools(client: JiraClient): ToolDefinition[] {
  const getIssue: ToolDefinition<z.infer<typeof issueKeySchema>> = {
    name: "jira.get_issue",
    description: "Fetch a Jira issue: summary, description, status, assignee, labels.",
    inputSchema: issueKeySchema,
    async execute(input) {
      return { ok: true, output: await client.getIssue(input.issueKey) };
    },
  };

  const getComments: ToolDefinition<z.infer<typeof issueKeySchema>> = {
    name: "jira.get_comments",
    description: "Fetch a Jira issue's comments.",
    inputSchema: issueKeySchema,
    async execute(input) {
      return { ok: true, output: await client.getComments(input.issueKey) };
    },
  };

  return [getIssue, getComments];
}

const addCommentInputSchema = z.object({ issueKey: z.string(), body: z.string().min(1) });
const updateIssueInputSchema = z.object({ issueKey: z.string(), status: z.string().min(1) });
const linkPrInputSchema = z.object({
  issueKey: z.string(),
  prUrl: z.string().min(1),
  prTitle: z.string().min(1),
});

/** Added in increment 13, alongside the Implementation Agent — the only role that gets these. */
export function createJiraWriteTools(client: JiraClient): ToolDefinition[] {
  const addComment: ToolDefinition<z.infer<typeof addCommentInputSchema>> = {
    name: "jira.add_comment",
    description: "Post a plain-text comment on a Jira issue.",
    inputSchema: addCommentInputSchema,
    async execute(input) {
      await client.addComment(input.issueKey, input.body);
      return { ok: true, output: undefined };
    },
  };

  // "update_issue" is a status transition, not a general field editor — see JiraClient.transitionIssue.
  const updateIssue: ToolDefinition<z.infer<typeof updateIssueInputSchema>> = {
    name: "jira.update_issue",
    description:
      'Transition a Jira issue to a target status by name (e.g. "In Progress", "In Review").',
    inputSchema: updateIssueInputSchema,
    async execute(input) {
      await client.transitionIssue(input.issueKey, input.status);
      return { ok: true, output: undefined };
    },
  };

  const linkPr: ToolDefinition<z.infer<typeof linkPrInputSchema>> = {
    name: "jira.link_pr",
    description: "Post a comment on a Jira issue linking an opened pull request.",
    inputSchema: linkPrInputSchema,
    async execute(input) {
      await client.linkPullRequest(input.issueKey, { url: input.prUrl, title: input.prTitle });
      return { ok: true, output: undefined };
    },
  };

  return [addComment, updateIssue, linkPr];
}
