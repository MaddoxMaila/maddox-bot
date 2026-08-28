import type { GitHubClient } from "@maddox-bot/github";
import { z } from "zod";
import type { ToolDefinition } from "../toolDefinition.js";

const repoAndNumberSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int(),
});
type RepoAndNumber = z.infer<typeof repoAndNumberSchema>;

const getRepositorySchema = z.object({ owner: z.string(), repo: z.string() });

/** Read-only for increment 11 — createBranch/push/createPr/comment/submitReview are wired in
 * increment 13, alongside the Implementation Agent that needs them. */
export function createGitHubReadTools(client: GitHubClient): ToolDefinition[] {
  const getRepository: ToolDefinition<z.infer<typeof getRepositorySchema>> = {
    name: "github.get_repository",
    description: "Fetch repository metadata (default branch, clone URL, visibility).",
    inputSchema: getRepositorySchema,
    async execute(input) {
      return { ok: true, output: await client.getRepository(input.owner, input.repo) };
    },
  };

  const getPr: ToolDefinition<RepoAndNumber> = {
    name: "github.get_pr",
    description: "Fetch a pull request's metadata.",
    inputSchema: repoAndNumberSchema,
    async execute(input) {
      return {
        ok: true,
        output: await client.getPullRequest(input.owner, input.repo, input.number),
      };
    },
  };

  const getPrDiff: ToolDefinition<RepoAndNumber> = {
    name: "github.get_pr_diff",
    description: "Fetch a pull request's unified diff.",
    inputSchema: repoAndNumberSchema,
    async execute(input) {
      return {
        ok: true,
        output: await client.getPullRequestDiff(input.owner, input.repo, input.number),
      };
    },
  };

  const getPrComments: ToolDefinition<RepoAndNumber> = {
    name: "github.get_pr_comments",
    description: "Fetch a pull request's issue-style comments.",
    inputSchema: repoAndNumberSchema,
    async execute(input) {
      return {
        ok: true,
        output: await client.getPullRequestComments(input.owner, input.repo, input.number),
      };
    },
  };

  const getReviews: ToolDefinition<RepoAndNumber> = {
    name: "github.get_reviews",
    description: "Fetch a pull request's reviews.",
    inputSchema: repoAndNumberSchema,
    async execute(input) {
      return { ok: true, output: await client.getReviews(input.owner, input.repo, input.number) };
    },
  };

  return [getRepository, getPr, getPrDiff, getPrComments, getReviews];
}
