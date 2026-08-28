// The minimal surface GitHubClient depends on — not Octokit's real (much larger) type surface.
// Keeping this narrow means unit tests can pass a plain object of functions instead of mocking
// the real @octokit/rest library. createOctokitAdapter (in octokitAdapter.ts) is the only file
// that touches the real Octokit types.

export interface RawGitHubRepo {
  owner: { login: string };
  name: string;
  default_branch: string;
  clone_url: string;
  private: boolean;
}

export interface RawGitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
}

export interface RawGitHubComment {
  id: number;
  user: { login: string } | null;
  body: string | null | undefined;
  created_at: string;
}

export interface RawGitHubReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  submitted_at: string | null | undefined;
}

export interface OctokitLike {
  getRepository(owner: string, repo: string): Promise<RawGitHubRepo>;
  getPullRequest(owner: string, repo: string, pullNumber: number): Promise<RawGitHubPullRequest>;
  getPullRequestDiff(owner: string, repo: string, pullNumber: number): Promise<string>;
  listIssueComments(owner: string, repo: string, issueNumber: number): Promise<RawGitHubComment[]>;
  listReviews(owner: string, repo: string, pullNumber: number): Promise<RawGitHubReview[]>;
}
