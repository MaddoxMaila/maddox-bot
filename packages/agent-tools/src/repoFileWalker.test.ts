import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileWithHash, walkFiles, writeFileEnsuringDir } from "./repoFileWalker.js";

describe("repoFileWalker path safety", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "maddox-bot-repo-walker-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("readFileWithHash rejects a path that escapes the repository root", async () => {
    await expect(readFileWithHash(baseDir, "../../etc/passwd")).rejects.toThrow(
      /escapes the repository root/,
    );
  });

  it("writeFileEnsuringDir rejects a path that escapes the repository root", async () => {
    await expect(writeFileEnsuringDir(baseDir, "../outside.txt", "x")).rejects.toThrow(
      /escapes the repository root/,
    );
  });

  it("walkFiles rejects a subPath that escapes the repository root", async () => {
    await expect(walkFiles(baseDir, "../")).rejects.toThrow(/escapes the repository root/);
  });

  it("writeFileEnsuringDir creates missing intermediate directories", async () => {
    const { sha } = await writeFileEnsuringDir(baseDir, "src/nested/new.ts", "export {};\n");

    const written = await readFile(join(baseDir, "src", "nested", "new.ts"), "utf8");
    expect(written).toBe("export {};\n");
    expect(sha).toHaveLength(64);
  });

  it("writeFileEnsuringDir overwrites an existing file", async () => {
    await mkdir(join(baseDir, "src"), { recursive: true });
    await writeFileEnsuringDir(baseDir, "src/file.ts", "old");

    await writeFileEnsuringDir(baseDir, "src/file.ts", "new");

    expect(await readFile(join(baseDir, "src", "file.ts"), "utf8")).toBe("new");
  });

  it("readFileWithHash and writeFileEnsuringDir agree on the same content's hash", async () => {
    const { sha: writeSha } = await writeFileEnsuringDir(baseDir, "a.txt", "hello");
    const { sha: readSha } = await readFileWithHash(baseDir, "a.txt");
    expect(readSha).toBe(writeSha);
  });
});
