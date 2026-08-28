import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepoTools } from "./repoTools.js";

function findTool(tools: ReturnType<typeof createRepoTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("createRepoTools", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "maddox-bot-repo-tools-"));
    await mkdir(join(baseDir, "src"), { recursive: true });
    await writeFile(
      join(baseDir, "src", "add.ts"),
      "export function add(a: number, b: number) {\n  return a + b;\n}\n",
    );
    await writeFile(
      join(baseDir, "src", "subtract.ts"),
      "import { add } from './add';\n\nexport function subtract(a: number, b: number) {\n  return add(a, -b);\n}\n",
    );
    await writeFile(join(baseDir, "README.md"), "# sample\n");
    await mkdir(join(baseDir, "node_modules", "left-pad"), { recursive: true });
    await writeFile(
      join(baseDir, "node_modules", "left-pad", "index.js"),
      "module.exports = () => {};\n",
    );
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("registers the five read-only repo tools", () => {
    const tools = createRepoTools(baseDir);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "repo.find_definition",
      "repo.find_references",
      "repo.list_files",
      "repo.read_file",
      "repo.search",
    ]);
  });

  it("repo.search finds a whole-word match and skips node_modules", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.search");
    const outcome = await tool.execute({ query: "add" }, {} as never);
    expect(outcome.ok).toBe(true);
    const hits = outcome.output as Array<{ path: string }>;
    expect(hits.some((hit) => hit.path === "src/add.ts")).toBe(true);
    expect(hits.some((hit) => hit.path.startsWith("node_modules"))).toBe(false);
  });

  it("repo.search respects a glob filter", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.search");
    const outcome = await tool.execute({ query: "sample", glob: "*.md" }, {} as never);
    const hits = outcome.output as Array<{ path: string }>;
    expect(hits).toEqual([{ path: "README.md", line: 1, text: "# sample" }]);
  });

  it("repo.read_file returns content and a stable content hash", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.read_file");
    const first = await tool.execute({ path: "README.md" }, {} as never);
    const second = await tool.execute({ path: "README.md" }, {} as never);
    expect(first).toEqual(second);
    expect((first.output as { content: string }).content).toBe("# sample\n");
  });

  it("repo.read_file reports a clear error for a missing file", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.read_file");
    const outcome = await tool.execute({ path: "does-not-exist.txt" }, {} as never);
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("read_failed");
  });

  it("repo.list_files lists recursively by default, skipping node_modules", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.list_files");
    const outcome = await tool.execute({}, {} as never);
    expect(outcome.output).toEqual(["README.md", "src/add.ts", "src/subtract.ts"]);
  });

  it("repo.list_files can list a single directory non-recursively", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.list_files");
    const outcome = await tool.execute({ path: "src", recursive: false }, {} as never);
    expect(outcome.output).toEqual(["src/add.ts", "src/subtract.ts"]);
  });

  it("repo.find_references finds a whole-word usage, not a substring inside another identifier", async () => {
    await writeFile(join(baseDir, "src", "addendum.ts"), "export const addendum = 1;\n");
    const tool = findTool(createRepoTools(baseDir), "repo.find_references");
    const outcome = await tool.execute({ symbol: "add" }, {} as never);
    const hits = outcome.output as Array<{ path: string }>;
    expect(hits.some((hit) => hit.path === "src/subtract.ts")).toBe(true);
    expect(hits.some((hit) => hit.path === "src/addendum.ts")).toBe(false);
  });

  it("repo.find_definition finds the declaration line, not just any reference", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.find_definition");
    const outcome = await tool.execute({ symbol: "add" }, {} as never);
    expect(outcome.output).toMatchObject({
      path: "src/add.ts",
      text: expect.stringContaining("function add"),
    });
  });

  it("repo.find_definition returns null when no declaration-like line matches", async () => {
    const tool = findTool(createRepoTools(baseDir), "repo.find_definition");
    const outcome = await tool.execute({ symbol: "totallyUnknownSymbol" }, {} as never);
    expect(outcome.output).toBeNull();
  });
});
