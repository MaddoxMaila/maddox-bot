import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "pnpm" | "yarn" | "npm";
export type ProjectScript = "test" | "lint" | "typecheck" | "build";

export interface DetectedCommand {
  packageManager: PackageManager;
  script: ProjectScript;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(workspaceDir: string): Promise<PackageManager> {
  if (await fileExists(join(workspaceDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(join(workspaceDir, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

/**
 * Node/TS via package.json scripts only, per the plan's Phase 1 scoping (spec §36 asks for
 * multi-language detection — pyproject.toml, go.mod, etc. — genuinely later work, not this
 * increment's). Returns null when the repo has no such script configured, which is a normal,
 * valid state — not every repo needs every check — not an error.
 */
export async function detectProjectCommand(
  workspaceDir: string,
  script: ProjectScript,
): Promise<DetectedCommand | null> {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(await readFile(join(workspaceDir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
  } catch {
    return null;
  }
  if (typeof packageJson.scripts?.[script] !== "string") {
    return null;
  }
  return { packageManager: await detectPackageManager(workspaceDir), script };
}
