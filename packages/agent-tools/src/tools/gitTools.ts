import type { GitClient } from "@maddox-bot/git";
import { z } from "zod";
import type { ToolDefinition } from "../toolDefinition.js";

const emptyInputSchema = z.object({});
const diffInputSchema = z.object({ base: z.string().optional(), staged: z.boolean().optional() });
const logInputSchema = z.object({ maxCount: z.number().int().positive().optional() });

/** Read-only for increment 11 — git.checkout/create_branch/commit/push are wired in increment 13. */
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
