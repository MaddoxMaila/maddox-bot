import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitClient } from "@maddox-bot/git";
import { Sandbox } from "@maddox-bot/sandbox";
import type { GitIdentityConfig } from "./workerDependencies.js";

export interface TaskWorkspace {
  directory: string;
  gitClient: GitClient;
  sandbox: Sandbox;
  destroy(): Promise<void>;
}

export interface CreateWorkspaceOptions {
  cloneUrl: string;
  githubToken: string;
  gitIdentity: GitIdentityConfig;
  sandboxImage: string;
}

/**
 * One clone + one sandbox container per task run, both ephemeral: a crash loses them entirely,
 * which is exactly why the worker's resume logic (taskRunner.ts) never tries to recover partial
 * in-progress state from a dead workspace — it restarts the stage from scratch instead. Not
 * persisted to the `workspaces` table yet (nothing reads workspace status yet — that's for
 * whatever first needs to show it, e.g. the VS Code dashboard).
 */
export async function createTaskWorkspace(options: CreateWorkspaceOptions): Promise<TaskWorkspace> {
  const directory = await mkdtemp(join(tmpdir(), "maddox-bot-workspace-"));
  const gitClient = await GitClient.clone({
    url: options.cloneUrl,
    directory,
    token: options.githubToken,
    identity: options.gitIdentity,
  });
  const sandbox = await Sandbox.create({
    image: options.sandboxImage,
    hostWorkspacePath: directory,
  });

  return {
    directory,
    gitClient,
    sandbox,
    async destroy() {
      await sandbox.destroy();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
