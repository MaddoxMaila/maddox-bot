import { Octokit } from "@octokit/rest";
import type {
  OctokitLike,
  RawGitHubComment,
  RawGitHubPullRequest,
  RawGitHubRepo,
  RawGitHubReview,
} from "./octokitLike.js";

export function createOctokitAdapter(token: string): OctokitLike {
  const octokit = new Octokit({ auth: token });
  return {
    async getRepository(owner, repo) {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data as RawGitHubRepo;
    },
    async getPullRequest(owner, repo, pullNumber) {
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return data as RawGitHubPullRequest;
    },
    async getPullRequestDiff(owner, repo, pullNumber) {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: "diff" },
      });
      // Octokit's typings describe this endpoint as always returning the PR object; passing the
      // diff media type actually returns the diff text in `data` at runtime. Cast reflects that.
      return data as unknown as string;
    },
    async listIssueComments(owner, repo, issueNumber) {
      const { data } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return data as RawGitHubComment[];
    },
    async listReviews(owner, repo, pullNumber) {
      const { data } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return data as RawGitHubReview[];
    },
    async createPullRequest(owner, repo, params) {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
        ...(params.draft !== undefined && { draft: params.draft }),
      });
      return data as RawGitHubPullRequest;
    },
    async createIssueComment(owner, repo, issueNumber, body) {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    },
  };
}
