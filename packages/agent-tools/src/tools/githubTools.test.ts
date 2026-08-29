import type { GitHubClient } from "@maddox-bot/github";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../toolDefinition.js";
import { createGitHubReadTools, createGitHubWriteTools } from "./githubTools.js";

function fakeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getRepository: vi.fn().mockResolvedValue({ owner: "octocat", name: "hello-world" }),
    getPullRequest: vi.fn().mockResolvedValue({ number: 42 }),
    getPullRequestDiff: vi.fn().mockResolvedValue("diff --git a b"),
    getPullRequestComments: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    createPullRequest: vi.fn().mockResolvedValue({ number: 7, url: "https://example.com/pr/7" }),
    commentOnPullRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitHubClient;
}

function findTool(tools: ToolDefinition[], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("createGitHubReadTools", () => {
  it("registers the five read-only GitHub tools", () => {
    const tools = createGitHubReadTools(fakeGitHubClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "github.get_pr",
      "github.get_pr_comments",
      "github.get_pr_diff",
      "github.get_repository",
      "github.get_reviews",
    ]);
  });

  it("github.get_repository delegates with owner/repo", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubReadTools(client), "github.get_repository");
    const outcome = await tool.execute({ owner: "octocat", repo: "hello-world" }, {} as never);
    expect(client.getRepository).toHaveBeenCalledWith("octocat", "hello-world");
    expect(outcome.ok).toBe(true);
  });

  it("github.get_pr delegates with owner/repo/number", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubReadTools(client), "github.get_pr");
    await tool.execute({ owner: "octocat", repo: "hello-world", number: 42 }, {} as never);
    expect(client.getPullRequest).toHaveBeenCalledWith("octocat", "hello-world", 42);
  });

  it("github.get_pr_diff delegates with owner/repo/number", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubReadTools(client), "github.get_pr_diff");
    const outcome = await tool.execute(
      { owner: "octocat", repo: "hello-world", number: 42 },
      {} as never,
    );
    expect(client.getPullRequestDiff).toHaveBeenCalledWith("octocat", "hello-world", 42);
    expect(outcome).toEqual({ ok: true, output: "diff --git a b" });
  });

  it("github.get_pr_comments delegates with owner/repo/number", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubReadTools(client), "github.get_pr_comments");
    await tool.execute({ owner: "octocat", repo: "hello-world", number: 42 }, {} as never);
    expect(client.getPullRequestComments).toHaveBeenCalledWith("octocat", "hello-world", 42);
  });

  it("github.get_reviews delegates with owner/repo/number", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubReadTools(client), "github.get_reviews");
    await tool.execute({ owner: "octocat", repo: "hello-world", number: 42 }, {} as never);
    expect(client.getReviews).toHaveBeenCalledWith("octocat", "hello-world", 42);
  });
});

describe("createGitHubWriteTools", () => {
  it("registers the two write GitHub tools", () => {
    const tools = createGitHubWriteTools(fakeGitHubClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual(["github.comment", "github.create_pr"]);
  });

  it("github.create_pr delegates and omits draft when not provided", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubWriteTools(client), "github.create_pr");

    const outcome = await tool.execute(
      {
        owner: "octocat",
        repo: "hello-world",
        title: "Add feature",
        body: "Implements PROJ-1",
        head: "feature/proj-1",
        base: "main",
      },
      {} as never,
    );

    expect(client.createPullRequest).toHaveBeenCalledWith("octocat", "hello-world", {
      title: "Add feature",
      body: "Implements PROJ-1",
      head: "feature/proj-1",
      base: "main",
    });
    expect(outcome).toEqual({
      ok: true,
      output: { number: 7, url: "https://example.com/pr/7" },
    });
  });

  it("github.create_pr forwards draft when explicitly set", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubWriteTools(client), "github.create_pr");

    await tool.execute(
      {
        owner: "octocat",
        repo: "hello-world",
        title: "t",
        body: "b",
        head: "h",
        base: "main",
        draft: true,
      },
      {} as never,
    );

    expect(client.createPullRequest).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      expect.objectContaining({ draft: true }),
    );
  });

  it("github.comment delegates to commentOnPullRequest", async () => {
    const client = fakeGitHubClient();
    const tool = findTool(createGitHubWriteTools(client), "github.comment");

    const outcome = await tool.execute(
      { owner: "octocat", repo: "hello-world", number: 7, body: "Looks good" },
      {} as never,
    );

    expect(client.commentOnPullRequest).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      7,
      "Looks good",
    );
    expect(outcome).toEqual({ ok: true, output: undefined });
  });
});
