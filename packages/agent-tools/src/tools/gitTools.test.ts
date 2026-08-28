import type { GitClient } from "@maddox-bot/git";
import { describe, expect, it, vi } from "vitest";
import { createGitReadTools } from "./gitTools.js";

function fakeGitClient(overrides: Partial<GitClient> = {}): GitClient {
  return {
    status: vi.fn().mockResolvedValue({ current: "main", files: [], isClean: true }),
    diff: vi.fn().mockResolvedValue(""),
    log: vi.fn().mockResolvedValue([]),
    branch: vi.fn().mockResolvedValue({ current: "main", all: ["main"] }),
    ...overrides,
  } as unknown as GitClient;
}

function findTool(tools: ReturnType<typeof createGitReadTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("createGitReadTools", () => {
  it("registers the four read-only git tools", () => {
    const tools = createGitReadTools(fakeGitClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "git.branch",
      "git.diff",
      "git.log",
      "git.status",
    ]);
  });

  it("git.status delegates to GitClient.status", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitReadTools(gitClient), "git.status");
    const outcome = await tool.execute({}, {} as never);
    expect(gitClient.status).toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, output: { current: "main", files: [], isClean: true } });
  });

  it("git.diff omits undefined fields rather than passing them through", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitReadTools(gitClient), "git.diff");
    await tool.execute({}, {} as never);
    expect(gitClient.diff).toHaveBeenCalledWith({});
  });

  it("git.diff forwards provided options", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitReadTools(gitClient), "git.diff");
    await tool.execute({ base: "main", staged: true }, {} as never);
    expect(gitClient.diff).toHaveBeenCalledWith({ base: "main", staged: true });
  });

  it("git.log forwards maxCount only when provided", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitReadTools(gitClient), "git.log");
    await tool.execute({}, {} as never);
    expect(gitClient.log).toHaveBeenCalledWith({});
    await tool.execute({ maxCount: 5 }, {} as never);
    expect(gitClient.log).toHaveBeenCalledWith({ maxCount: 5 });
  });

  it("git.branch delegates to GitClient.branch", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitReadTools(gitClient), "git.branch");
    const outcome = await tool.execute({}, {} as never);
    expect(gitClient.branch).toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, output: { current: "main", all: ["main"] } });
  });
});
