import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

export async function walkFiles(baseDir: string, subPath = "."): Promise<string[]> {
  const results: string[] = [];
  const startDir = join(baseDir, subPath);

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
  const content = await readFile(join(baseDir, relativePath), "utf8");
  const sha = createHash("sha256").update(content).digest("hex");
  return { content, sha };
}
