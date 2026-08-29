import type { GitClient } from "@maddox-bot/git";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../toolDefinition.js";
import { createGitReadTools, createGitWriteTools } from "./gitTools.js";

function fakeGitClient(overrides: Partial<GitClient> = {}): GitClient {
  return {
    status: vi.fn().mockResolvedValue({ current: "main", files: [], isClean: true }),
    diff: vi.fn().mockResolvedValue(""),
    log: vi.fn().mockResolvedValue([]),
    branch: vi.fn().mockResolvedValue({ current: "main", all: ["main"] }),
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ sha: "abc123" }),
    push: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitClient;
}

function findTool(tools: ToolDefinition[], name: string) {
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

describe("createGitWriteTools", () => {
  it("registers the four write git tools", () => {
    const tools = createGitWriteTools(fakeGitClient());
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "git.checkout",
      "git.commit",
      "git.create_branch",
      "git.push",
    ]);
  });

  it("git.create_branch delegates to GitClient.createBranch", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitWriteTools(gitClient), "git.create_branch");
    const outcome = await tool.execute({ name: "feature/x", from: "main" }, {} as never);
    expect(gitClient.createBranch).toHaveBeenCalledWith("feature/x", "main");
    expect(outcome).toEqual({ ok: true, output: undefined });
  });

  it("git.checkout delegates to GitClient.checkout", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitWriteTools(gitClient), "git.checkout");
    await tool.execute({ branch: "main" }, {} as never);
    expect(gitClient.checkout).toHaveBeenCalledWith("main");
  });

  it("git.commit passes the message and optional files through", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitWriteTools(gitClient), "git.commit");
    const outcome = await tool.execute({ message: "feat: add thing" }, {} as never);
    expect(gitClient.commit).toHaveBeenCalledWith("feat: add thing", undefined);
    expect(outcome).toEqual({ ok: true, output: { sha: "abc123" } });
  });

  it("git.push omits force when not provided, and forwards it when true", async () => {
    const gitClient = fakeGitClient();
    const tool = findTool(createGitWriteTools(gitClient), "git.push");
    await tool.execute({ branch: "feature/x" }, {} as never);
    expect(gitClient.push).toHaveBeenCalledWith("feature/x", {});
    await tool.execute({ branch: "feature/x", force: true }, {} as never);
    expect(gitClient.push).toHaveBeenCalledWith("feature/x", { force: true });
  });
});
