import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRepos, mockPulls, mockIssues } = vi.hoisted(() => ({
  mockRepos: { get: vi.fn() },
  mockPulls: { get: vi.fn(), listReviews: vi.fn() },
  mockIssues: { listComments: vi.fn() },
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: { repos: mockRepos, pulls: mockPulls, issues: mockIssues },
  })),
}));

const { Octokit } = await import("@octokit/rest");
const { createOctokitAdapter } = await import("./octokitAdapter.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOctokitAdapter", () => {
  it("constructs Octokit with the given token", () => {
    createOctokitAdapter("test-token");
    expect(Octokit).toHaveBeenCalledWith({ auth: "test-token" });
  });

  it("getRepository calls repos.get with the right params and unwraps .data", async () => {
    mockRepos.get.mockResolvedValue({ data: { name: "hello-world" } });
    const adapter = createOctokitAdapter("test-token");

    const result = await adapter.getRepository("octocat", "hello-world");

    expect(mockRepos.get).toHaveBeenCalledWith({ owner: "octocat", repo: "hello-world" });
    expect(result).toEqual({ name: "hello-world" });
  });

  it("getPullRequest calls pulls.get with pull_number and unwraps .data", async () => {
    mockPulls.get.mockResolvedValue({ data: { number: 42 } });
    const adapter = createOctokitAdapter("test-token");

    const result = await adapter.getPullRequest("octocat", "hello-world", 42);

    expect(mockPulls.get).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "hello-world",
      pull_number: 42,
    });
    expect(result).toEqual({ number: 42 });
  });

  it("getPullRequestDiff requests the diff media type", async () => {
    mockPulls.get.mockResolvedValue({ data: "diff --git a b" });
    const adapter = createOctokitAdapter("test-token");

    const result = await adapter.getPullRequestDiff("octocat", "hello-world", 42);

    expect(mockPulls.get).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "hello-world",
      pull_number: 42,
      mediaType: { format: "diff" },
    });
    expect(result).toBe("diff --git a b");
  });

  it("listIssueComments calls issues.listComments with issue_number and unwraps .data", async () => {
    mockIssues.listComments.mockResolvedValue({ data: [{ id: 1 }] });
    const adapter = createOctokitAdapter("test-token");

    const result = await adapter.listIssueComments("octocat", "hello-world", 42);

    expect(mockIssues.listComments).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "hello-world",
      issue_number: 42,
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("listReviews calls pulls.listReviews with pull_number and unwraps .data", async () => {
    mockPulls.listReviews.mockResolvedValue({ data: [{ id: 1 }] });
    const adapter = createOctokitAdapter("test-token");

    const result = await adapter.listReviews("octocat", "hello-world", 42);

    expect(mockPulls.listReviews).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "hello-world",
      pull_number: 42,
    });
    expect(result).toEqual([{ id: 1 }]);
  });
});
