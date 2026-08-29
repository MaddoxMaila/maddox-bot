import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

/**
 * A tool input like `path: "../../etc/passwd"` would otherwise resolve outside baseDir via a bare
 * join() — every function here that takes a caller-supplied relative path resolves it through this
 * first, so a hallucinated or adversarial path can only ever reach inside the repository root.
 */
function resolveWithinRepo(baseDir: string, relativePath: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = resolve(baseDir, relativePath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Path escapes the repository root: ${relativePath}`);
  }
  return resolvedTarget;
}

export async function walkFiles(baseDir: string, subPath = "."): Promise<string[]> {
  const results: string[] = [];
  const startDir = resolveWithinRepo(baseDir, subPath);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
          await walk(join(dir, entry.name));
        }
        continue;
      }
      if (entry.isFile()) {
        results.push(relative(baseDir, join(dir, entry.name)));
      }
    }
  }

  await walk(startDir);
  return results.sort();
}

export async function readFileWithHash(
  baseDir: string,
  relativePath: string,
): Promise<{ content: string; sha: string }> {
  const content = await readFile(resolveWithinRepo(baseDir, relativePath), "utf8");
  const sha = createHash("sha256").update(content).digest("hex");
  return { content, sha };
}

export async function writeFileEnsuringDir(
  baseDir: string,
  relativePath: string,
  content: string,
): Promise<{ sha: string }> {
  const target = resolveWithinRepo(baseDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  const sha = createHash("sha256").update(content).digest("hex");
  return { sha };
}
