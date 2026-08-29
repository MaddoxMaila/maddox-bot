import type { GitClient } from "@maddox-bot/git";
import { z } from "zod";
import type { ToolDefinition } from "../toolDefinition.js";

const emptyInputSchema = z.object({});
const diffInputSchema = z.object({ base: z.string().optional(), staged: z.boolean().optional() });
const logInputSchema = z.object({ maxCount: z.number().int().positive().optional() });

/** Read tools since increment 11 — createGitWriteTools() below adds checkout/create_branch/
 * commit/push (increment 13), kept separate so a role like the Planner gets read tools only. */
export function createGitReadTools(gitClient: GitClient): ToolDefinition[] {
  const status: ToolDefinition<z.infer<typeof emptyInputSchema>> = {
    name: "git.status",
    description: "Show the working tree status: current branch, changed/untracked files.",
    inputSchema: emptyInputSchema,
    async execute() {
      return { ok: true, output: await gitClient.status() };
    },
  };

  const diff: ToolDefinition<z.infer<typeof diffInputSchema>> = {
    name: "git.diff",
    description:
      "Show the diff for uncommitted changes, optionally staged-only or against a base ref.",
    inputSchema: diffInputSchema,
    async execute(input) {
      // Zod's .optional() types a present-but-possibly-undefined value; GitClient's DiffOptions
      // wants the key absent, not present-with-undefined (exactOptionalPropertyTypes).
      return {
        ok: true,
        output: await gitClient.diff({
          ...(input.base !== undefined && { base: input.base }),
          ...(input.staged !== undefined && { staged: input.staged }),
        }),
      };
    },
  };

  const log: ToolDefinition<z.infer<typeof logInputSchema>> = {
    name: "git.log",
    description: "Show recent commit history.",
    inputSchema: logInputSchema,
    async execute(input) {
      return {
        ok: true,
        output: await gitClient.log({
          ...(input.maxCount !== undefined && { maxCount: input.maxCount }),
        }),
      };
    },
  };

  const branch: ToolDefinition<z.infer<typeof emptyInputSchema>> = {
    name: "git.branch",
    description: "Show the current branch and all local branches.",
    inputSchema: emptyInputSchema,
    async execute() {
      return { ok: true, output: await gitClient.branch() };
    },
  };

  return [status, diff, log, branch];
}

const createBranchInputSchema = z.object({
  name: z.string().min(1),
  from: z.string().optional(),
});
const checkoutInputSchema = z.object({ branch: z.string().min(1) });
const commitInputSchema = z.object({
  message: z.string().min(1),
  files: z.array(z.string()).optional(),
});
const pushInputSchema = z.object({ branch: z.string().min(1), force: z.boolean().optional() });

/** Added in increment 13, alongside the Implementation Agent — the only role that gets these. */
export function createGitWriteTools(gitClient: GitClient): ToolDefinition[] {
  const createBranch: ToolDefinition<z.infer<typeof createBranchInputSchema>> = {
    name: "git.create_branch",
    description: "Create and switch to a new local branch, optionally from a specific base ref.",
    inputSchema: createBranchInputSchema,
    async execute(input) {
      await gitClient.createBranch(input.name, input.from);
      return { ok: true, output: undefined };
    },
  };

  const checkout: ToolDefinition<z.infer<typeof checkoutInputSchema>> = {
    name: "git.checkout",
    description: "Switch to an existing local branch.",
    inputSchema: checkoutInputSchema,
    async execute(input) {
      await gitClient.checkout(input.branch);
      return { ok: true, output: undefined };
    },
  };

  const commit: ToolDefinition<z.infer<typeof commitInputSchema>> = {
    name: "git.commit",
    description: "Stage and commit changes. Omit files to stage everything.",
    inputSchema: commitInputSchema,
    async execute(input) {
      return { ok: true, output: await gitClient.commit(input.message, input.files) };
    },
  };

  const push: ToolDefinition<z.infer<typeof pushInputSchema>> = {
    name: "git.push",
    description: "Push a branch to the origin remote.",
    inputSchema: pushInputSchema,
    async execute(input) {
      await gitClient.push(input.branch, {
        ...(input.force !== undefined && { force: input.force }),
      });
      return { ok: true, output: undefined };
    },
  };

  return [createBranch, checkout, commit, push];
}
