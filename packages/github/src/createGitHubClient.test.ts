import { describe, expect, it, vi } from "vitest";

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: { repos: {}, pulls: {}, issues: {} },
  })),
}));

const { createGitHubClient } = await import("./createGitHubClient.js");
const { GitHubClient } = await import("./githubClient.js");

describe("createGitHubClient", () => {
  it("returns a GitHubClient wired to an Octokit-backed adapter", () => {
    const client = createGitHubClient("test-token");
    expect(client).toBeInstanceOf(GitHubClient);
  });
});
