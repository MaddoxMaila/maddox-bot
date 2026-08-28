import type { JiraClient } from "@maddox-bot/jira";
import { z } from "zod";
import type { ToolDefinition } from "../toolDefinition.js";

const issueKeySchema = z.object({ issueKey: z.string() });

/** Read-only for increment 11 — updateIssue/addComment/linkPr are wired in increment 13. */
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
