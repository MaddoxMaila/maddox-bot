import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "./githubClient.js";
import type { OctokitLike } from "./octokitLike.js";

function fakeApi(overrides: Partial<OctokitLike> = {}): OctokitLike {
  return {
    getRepository: vi.fn(),
    getPullRequest: vi.fn(),
    getPullRequestDiff: vi.fn(),
    listIssueComments: vi.fn(),
    listReviews: vi.fn(),
    createPullRequest: vi.fn(),
    createIssueComment: vi.fn(),
    ...overrides,
  };
}

describe("GitHubClient", () => {
  it("getRepository maps the raw shape to the domain shape", async () => {
    const api = fakeApi({
      getRepository: vi.fn().mockResolvedValue({
        owner: { login: "octocat" },
        name: "hello-world",
        default_branch: "main",
        clone_url: "https://github.com/octocat/hello-world.git",
        private: false,
      }),
    });
    const client = new GitHubClient(api);

    const repo = await client.getRepository("octocat", "hello-world");

    expect(repo).toEqual({
      owner: "octocat",
      name: "hello-world",
      defaultBranch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
      private: false,
    });
    expect(api.getRepository).toHaveBeenCalledWith("octocat", "hello-world");
  });

  it("getPullRequest maps the raw shape and defaults a null body to an empty string", async () => {
    const api = fakeApi({
      getPullRequest: vi.fn().mockResolvedValue({
        number: 42,
        title: "Add feature",
        body: null,
        state: "open",
        draft: false,
        merged: false,
        html_url: "https://github.com/octocat/hello-world/pull/42",
        head: { ref: "feature/x", sha: "abc123" },
        base: { ref: "main" },
      }),
    });
    const client = new GitHubClient(api);

    const pr = await client.getPullRequest("octocat", "hello-world", 42);

    expect(pr).toEqual({
      number: 42,
      title: "Add feature",
      body: "",
      state: "open",
      draft: false,
      merged: false,
      url: "https://github.com/octocat/hello-world/pull/42",
      headRef: "feature/x",
      headSha: "abc123",
      baseRef: "main",
    });
  });

  it("getPullRequestDiff passes the diff straight through", async () => {
    const api = fakeApi({ getPullRequestDiff: vi.fn().mockResolvedValue("diff --git a b") });
    const client = new GitHubClient(api);

    await expect(client.getPullRequestDiff("octocat", "hello-world", 42)).resolves.toBe(
      "diff --git a b",
    );
  });

  it("getPullRequestComments defaults a missing author and body", async () => {
    const api = fakeApi({
      listIssueComments: vi.fn().mockResolvedValue([
        {
          id: 1,
          user: { login: "reviewer" },
          body: "Looks good",
          created_at: "2026-01-01T00:00:00Z",
        },
        { id: 2, user: null, body: undefined, created_at: "2026-01-02T00:00:00Z" },
      ]),
    });
    const client = new GitHubClient(api);

    const comments = await client.getPullRequestComments("octocat", "hello-world", 42);

    expect(comments).toEqual([
      { id: 1, author: "reviewer", body: "Looks good", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("getReviews defaults a missing author and submittedAt", async () => {
    const api = fakeApi({
      listReviews: vi.fn().mockResolvedValue([
        {
          id: 1,
          user: { login: "reviewer" },
          state: "APPROVED",
          body: null,
          submitted_at: "2026-01-01T00:00:00Z",
        },
        { id: 2, user: null, state: "PENDING", body: null, submitted_at: undefined },
      ]),
    });
    const client = new GitHubClient(api);

    const reviews = await client.getReviews("octocat", "hello-world", 42);

    expect(reviews).toEqual([
      {
        id: 1,
        author: "reviewer",
        state: "APPROVED",
        body: null,
        submittedAt: "2026-01-01T00:00:00Z",
      },
      { id: 2, author: "unknown", state: "PENDING", body: null, submittedAt: null },
    ]);
  });

  it("createPullRequest passes the input through and maps the created PR", async () => {
    const api = fakeApi({
      createPullRequest: vi.fn().mockResolvedValue({
        number: 7,
        title: "Add feature",
        body: "Implements PROJ-1",
        state: "open",
        draft: false,
        merged: false,
        html_url: "https://github.com/octocat/hello-world/pull/7",
        head: { ref: "feature/proj-1", sha: "abc123" },
        base: { ref: "main" },
      }),
    });
    const client = new GitHubClient(api);

    const pr = await client.createPullRequest("octocat", "hello-world", {
      title: "Add feature",
      body: "Implements PROJ-1",
      head: "feature/proj-1",
      base: "main",
    });

    expect(api.createPullRequest).toHaveBeenCalledWith("octocat", "hello-world", {
      title: "Add feature",
      body: "Implements PROJ-1",
      head: "feature/proj-1",
      base: "main",
    });
    expect(pr).toEqual({
      number: 7,
      title: "Add feature",
      body: "Implements PROJ-1",
      state: "open",
      draft: false,
      merged: false,
      url: "https://github.com/octocat/hello-world/pull/7",
      headRef: "feature/proj-1",
      headSha: "abc123",
      baseRef: "main",
    });
  });

  it("createPullRequest forwards draft only when explicitly set", async () => {
    const api = fakeApi({
      createPullRequest: vi.fn().mockResolvedValue({
        number: 7,
        title: "Add feature",
        body: null,
        state: "open",
        draft: true,
        merged: false,
        html_url: "https://github.com/octocat/hello-world/pull/7",
        head: { ref: "feature/proj-1", sha: "abc123" },
        base: { ref: "main" },
      }),
    });
    const client = new GitHubClient(api);

    await client.createPullRequest("octocat", "hello-world", {
      title: "Add feature",
      body: "",
      head: "feature/proj-1",
      base: "main",
      draft: true,
    });

    expect(api.createPullRequest).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      expect.objectContaining({ draft: true }),
    );
  });

  it("commentOnPullRequest delegates to createIssueComment", async () => {
    const api = fakeApi();
    const client = new GitHubClient(api);

    await client.commentOnPullRequest("octocat", "hello-world", 7, "Looks good");

    expect(api.createIssueComment).toHaveBeenCalledWith("octocat", "hello-world", 7, "Looks good");
  });
});
