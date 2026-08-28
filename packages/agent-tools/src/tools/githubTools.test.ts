import type { GitHubClient } from "@maddox-bot/github";
import { describe, expect, it, vi } from "vitest";
import { createGitHubReadTools } from "./githubTools.js";

function fakeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getRepository: vi.fn().mockResolvedValue({ owner: "octocat", name: "hello-world" }),
    getPullRequest: vi.fn().mockResolvedValue({ number: 42 }),
    getPullRequestDiff: vi.fn().mockResolvedValue("diff --git a b"),
    getPullRequestComments: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as GitHubClient;
}

function findTool(tools: ReturnType<typeof createGitHubReadTools>, name: string) {
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
