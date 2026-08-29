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

/** Read tools since increment 11 — createGitHubWriteTools() below adds create_pr/comment
 * (increment 13); submit_review stays unwired (approval_required, not yet governed by a review
 * delegation policy — see @maddox-bot/permissions). */
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

const createPrInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  title: z.string().min(1),
  body: z.string(),
  head: z.string().min(1),
  base: z.string().min(1),
  draft: z.boolean().optional(),
});

const commentInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int(),
  body: z.string().min(1),
});

/** Added in increment 13, alongside the Implementation Agent — the only role that gets these. */
export function createGitHubWriteTools(client: GitHubClient): ToolDefinition[] {
  const createPr: ToolDefinition<z.infer<typeof createPrInputSchema>> = {
    name: "github.create_pr",
    description: "Open a pull request from an already-pushed branch.",
    inputSchema: createPrInputSchema,
    async execute(input) {
      const pr = await client.createPullRequest(input.owner, input.repo, {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        ...(input.draft !== undefined && { draft: input.draft }),
      });
      return { ok: true, output: pr };
    },
  };

  const comment: ToolDefinition<z.infer<typeof commentInputSchema>> = {
    name: "github.comment",
    description: "Post a comment on a pull request.",
    inputSchema: commentInputSchema,
    async execute(input) {
      await client.commentOnPullRequest(input.owner, input.repo, input.number, input.body);
      return { ok: true, output: undefined };
    },
  };

  return [createPr, comment];
}
