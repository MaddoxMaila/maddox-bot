import type { OctokitLike } from "./octokitLike.js";

export interface GitHubRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl: string;
  private: boolean;
}

export interface GitHubPullRequestInfo {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  url: string;
  headRef: string;
  headSha: string;
  baseRef: string;
}

export interface GitHubCommentInfo {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface GitHubReviewInfo {
  id: number;
  author: string;
  state: string;
  body: string | null;
  submittedAt: string | null;
}

/** Read-only for now (increment 5); write operations (branch/push/PR/comment) land in increment 13. */
export class GitHubClient {
  constructor(private readonly api: OctokitLike) {}

  async getRepository(owner: string, repo: string): Promise<GitHubRepositoryInfo> {
    const raw = await this.api.getRepository(owner, repo);
    return {
      owner: raw.owner.login,
      name: raw.name,
      defaultBranch: raw.default_branch,
      cloneUrl: raw.clone_url,
      private: raw.private,
    };
  }

  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequestInfo> {
    const raw = await this.api.getPullRequest(owner, repo, number);
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state,
      draft: raw.draft,
      merged: raw.merged,
      url: raw.html_url,
      headRef: raw.head.ref,
      headSha: raw.head.sha,
      baseRef: raw.base.ref,
    };
  }

  async getPullRequestDiff(owner: string, repo: string, number: number): Promise<string> {
    return this.api.getPullRequestDiff(owner, repo, number);
  }

  async getPullRequestComments(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubCommentInfo[]> {
    const raw = await this.api.listIssueComments(owner, repo, number);
    return raw.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.created_at,
    }));
  }

  async getReviews(owner: string, repo: string, number: number): Promise<GitHubReviewInfo[]> {
    const raw = await this.api.listReviews(owner, repo, number);
    return raw.map((review) => ({
      id: review.id,
      author: review.user?.login ?? "unknown",
      state: review.state,
      body: review.body,
      submittedAt: review.submitted_at ?? null,
    }));
  }
}
