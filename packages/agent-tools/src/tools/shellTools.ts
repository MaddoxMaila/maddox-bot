import type { Sandbox } from "@maddox-bot/sandbox";
import { z } from "zod";
import { detectProjectCommand, type ProjectScript } from "../projectToolingDetector.js";
import type { ToolDefinition } from "../toolDefinition.js";

interface ShellCheckOutput {
  skipped: boolean;
  reason?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

const emptyInputSchema = z.object({});

function createProjectCheckTool(
  name: string,
  script: ProjectScript,
  description: string,
  sandbox: Sandbox,
  hostWorkspacePath: string,
): ToolDefinition<z.infer<typeof emptyInputSchema>, ShellCheckOutput> {
  return {
    name,
    description,
    inputSchema: emptyInputSchema,
    async execute() {
      const detected = await detectProjectCommand(hostWorkspacePath, script);
      if (!detected) {
        return { ok: true, output: { skipped: true, reason: `no "${script}" script configured` } };
      }
      // "npm run test" also works for npm, but "run" is the one subcommand every package
      // manager accepts uniformly — simpler than special-casing npm/pnpm's shorter aliases.
      const result = await sandbox.exec([detected.packageManager, "run", script]);
      return {
        ok: true,
        output: {
          skipped: false,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
        },
      };
    },
  };
}

/** Always-safe validation commands (spec §20's own example of a safe action). Not "shell.run" —
 * that generic escape hatch is deliberately gated regardless of command; see @maddox-bot/permissions. */
export function createShellTools(sandbox: Sandbox, hostWorkspacePath: string): ToolDefinition[] {
  return [
    createProjectCheckTool(
      "shell.run_tests",
      "test",
      "Run the project's test script, if one is configured.",
      sandbox,
      hostWorkspacePath,
    ),
    createProjectCheckTool(
      "shell.run_lint",
      "lint",
      "Run the project's lint script, if one is configured.",
      sandbox,
      hostWorkspacePath,
    ),
    createProjectCheckTool(
      "shell.run_typecheck",
      "typecheck",
      "Run the project's typecheck script, if one is configured.",
      sandbox,
      hostWorkspacePath,
    ),
    createProjectCheckTool(
      "shell.run_build",
      "build",
      "Run the project's build script, if one is configured.",
      sandbox,
      hostWorkspacePath,
    ),
  ];
}
