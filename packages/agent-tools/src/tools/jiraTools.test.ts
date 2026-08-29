import type { JiraClient } from "@maddox-bot/jira";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../toolDefinition.js";
import { createJiraReadTools, createJiraWriteTools } from "./jiraTools.js";

function fakeJiraClient(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    getIssue: vi.fn().mockResolvedValue({ key: "PROJ-481", summary: "Add password reset" }),
    getComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    linkPullRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as JiraClient;
}

function findTool(tools: ToolDefinition[], name: string) {
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

describe("createJiraWriteTools", () => {
  it("registers the three write Jira tools", () => {
    const tools = createJiraWriteTools(fakeJiraClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "jira.add_comment",
      "jira.link_pr",
      "jira.update_issue",
    ]);
  });

  it("jira.add_comment delegates with the issue key and body", async () => {
    const client = fakeJiraClient();
    const tool = findTool(createJiraWriteTools(client), "jira.add_comment");
    const outcome = await tool.execute(
      { issueKey: "PROJ-481", body: "Started work on this." },
      {} as never,
    );
    expect(client.addComment).toHaveBeenCalledWith("PROJ-481", "Started work on this.");
    expect(outcome).toEqual({ ok: true, output: undefined });
  });

  it("jira.update_issue delegates to transitionIssue with the target status", async () => {
    const client = fakeJiraClient();
    const tool = findTool(createJiraWriteTools(client), "jira.update_issue");
    await tool.execute({ issueKey: "PROJ-481", status: "In Review" }, {} as never);
    expect(client.transitionIssue).toHaveBeenCalledWith("PROJ-481", "In Review");
  });

  it("jira.link_pr delegates to linkPullRequest with url and title", async () => {
    const client = fakeJiraClient();
    const tool = findTool(createJiraWriteTools(client), "jira.link_pr");
    await tool.execute(
      {
        issueKey: "PROJ-481",
        prUrl: "https://github.com/acme/widgets/pull/7",
        prTitle: "Add password reset",
      },
      {} as never,
    );
    expect(client.linkPullRequest).toHaveBeenCalledWith("PROJ-481", {
      url: "https://github.com/acme/widgets/pull/7",
      title: "Add password reset",
    });
  });
});
