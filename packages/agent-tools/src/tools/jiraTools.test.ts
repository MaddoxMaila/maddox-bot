import type { JiraClient } from "@maddox-bot/jira";
import { describe, expect, it, vi } from "vitest";
import { createJiraReadTools } from "./jiraTools.js";

function fakeJiraClient(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    getIssue: vi.fn().mockResolvedValue({ key: "PROJ-481", summary: "Add password reset" }),
    getComments: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as JiraClient;
}

function findTool(tools: ReturnType<typeof createJiraReadTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("createJiraReadTools", () => {
  it("registers the two read-only Jira tools", () => {
    const tools = createJiraReadTools(fakeJiraClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual(["jira.get_comments", "jira.get_issue"]);
  });

  it("jira.get_issue delegates with the issue key", async () => {
    const client = fakeJiraClient();
    const tool = findTool(createJiraReadTools(client), "jira.get_issue");
    const outcome = await tool.execute({ issueKey: "PROJ-481" }, {} as never);
    expect(client.getIssue).toHaveBeenCalledWith("PROJ-481");
    expect(outcome).toEqual({
      ok: true,
      output: { key: "PROJ-481", summary: "Add password reset" },
    });
  });

  it("jira.get_comments delegates with the issue key", async () => {
    const client = fakeJiraClient();
    const tool = findTool(createJiraReadTools(client), "jira.get_comments");
    await tool.execute({ issueKey: "PROJ-481" }, {} as never);
    expect(client.getComments).toHaveBeenCalledWith("PROJ-481");
  });
});
