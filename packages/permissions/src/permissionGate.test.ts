import { describe, expect, it } from "vitest";
import { PermissionGate } from "./permissionGate.js";

describe("PermissionGate — fixed-tier tools", () => {
  const gate = new PermissionGate();

  it.each([
    "git.status",
    "git.diff",
    "git.log",
    "git.branch",
    "git.checkout",
    "git.create_branch",
    "repo.search",
    "repo.read_file",
    "repo.list_files",
    "repo.find_references",
    "repo.find_definition",
    "github.get_repository",
    "github.get_pr",
    "github.get_pr_diff",
    "github.get_pr_comments",
    "github.get_reviews",
    "github.create_pr",
    "github.comment",
    "jira.get_issue",
    "jira.get_comments",
    "jira.update_issue",
    "jira.add_comment",
    "jira.link_pr",
    "shell.run_tests",
    "shell.run_lint",
    "shell.run_typecheck",
    "shell.run_build",
  ])("%s is safe", (toolName) => {
    expect(gate.classify({ toolName, input: {} }).tier).toBe("safe");
  });

  it("github.submit_review requires approval (no review-delegation policy yet)", () => {
    expect(gate.classify({ toolName: "github.submit_review", input: {} }).tier).toBe(
      "approval_required",
    );
  });

  it("an unrecognized tool name fails closed to approval_required", () => {
    const decision = gate.classify({ toolName: "shell.rm_rf_everything", input: {} });
    expect(decision).toEqual({ tier: "approval_required", reason: "unrecognized_tool" });
  });
});

describe("PermissionGate — shell.run", () => {
  const gate = new PermissionGate();

  it.each([
    "npm install",
    "npm install lodash",
    "pnpm add left-pad",
    "yarn add -D vitest",
    "pip install requests",
    "cargo add serde",
    "echo hi && npm install",
  ])("flags a dependency install: %s", (command) => {
    const decision = gate.classify({ toolName: "shell.run", input: { command } });
    expect(decision).toEqual({ tier: "approval_required", reason: "dependency_install" });
  });

  it("does not treat an npm script named 'install-deps' as an install", () => {
    const decision = gate.classify({
      toolName: "shell.run",
      input: { command: "npm run install-deps" },
    });
    expect(decision.reason).toBe("unrecognized_shell_command");
  });

  it("still requires approval for a shell.run that isn't a dependency install", () => {
    const decision = gate.classify({
      toolName: "shell.run",
      input: { command: "rm -rf node_modules" },
    });
    expect(decision).toEqual({ tier: "approval_required", reason: "unrecognized_shell_command" });
  });

  it("treats malformed input as unrecognized rather than throwing", () => {
    const decision = gate.classify({ toolName: "shell.run", input: {} });
    expect(decision.tier).toBe("approval_required");
  });
});

describe("PermissionGate — repo.write_file", () => {
  const gate = new PermissionGate();

  it("is safe for a routine source path", () => {
    expect(
      gate.classify({ toolName: "repo.write_file", input: { path: "src/index.ts" } }).tier,
    ).toBe("safe");
  });

  it.each([".github/workflows/ci.yml", "infra/main.tf", "prisma/migrations/001_init.sql"])(
    "requires approval for a sensitive path: %s",
    (path) => {
      const decision = gate.classify({ toolName: "repo.write_file", input: { path } });
      expect(decision).toEqual({ tier: "approval_required", reason: "sensitive_path" });
    },
  );

  it("respects custom sensitive path patterns", () => {
    const customGate = new PermissionGate({ sensitivePathPatterns: [/^secrets\//] });
    expect(
      customGate.classify({ toolName: "repo.write_file", input: { path: "secrets/key.pem" } }).tier,
    ).toBe("approval_required");
    expect(
      customGate.classify({
        toolName: "repo.write_file",
        input: { path: ".github/workflows/ci.yml" },
      }).tier,
    ).toBe("safe");
  });

  it("treats missing path as malformed input requiring approval", () => {
    const decision = gate.classify({ toolName: "repo.write_file", input: {} });
    expect(decision).toEqual({ tier: "approval_required", reason: "malformed_input" });
  });
});

describe("PermissionGate — git.push / github.push", () => {
  const gate = new PermissionGate();

  it.each(["git.push", "github.push"])("%s to a feature branch is safe", (toolName) => {
    const decision = gate.classify({ toolName, input: { branch: "feature/x" } });
    expect(decision).toEqual({ tier: "safe", reason: "routine_action_of_an_authorized_task" });
  });

  it.each(["git.push", "github.push"])("%s with force requires approval", (toolName) => {
    const decision = gate.classify({ toolName, input: { branch: "feature/x", force: true } });
    expect(decision).toEqual({ tier: "approval_required", reason: "force_push" });
  });

  it.each(["main", "master"])("pushing directly to %s is human-only", (branch) => {
    const decision = gate.classify({ toolName: "git.push", input: { branch } });
    expect(decision).toEqual({ tier: "human_only", reason: "protected_branch" });
  });

  it("respects a custom protected-branch list", () => {
    const customGate = new PermissionGate({ protectedBranches: ["release"] });
    expect(customGate.classify({ toolName: "git.push", input: { branch: "release" } }).tier).toBe(
      "human_only",
    );
    expect(customGate.classify({ toolName: "git.push", input: { branch: "main" } }).tier).toBe(
      "safe",
    );
  });

  it("treats missing branch as malformed input requiring approval", () => {
    const decision = gate.classify({ toolName: "git.push", input: {} });
    expect(decision).toEqual({ tier: "approval_required", reason: "malformed_input" });
  });
});

describe("PermissionGate — git.commit", () => {
  it("is safe when no linesDeleted context is given", () => {
    const gate = new PermissionGate();
    expect(gate.classify({ toolName: "git.commit", input: {} }).tier).toBe("safe");
  });

  it("is safe below the large-deletion threshold", () => {
    const gate = new PermissionGate({ largeDeletionLineThreshold: 200 });
    expect(gate.classify({ toolName: "git.commit", input: {}, linesDeleted: 199 }).tier).toBe(
      "safe",
    );
  });

  it("requires approval above the large-deletion threshold", () => {
    const gate = new PermissionGate({ largeDeletionLineThreshold: 200 });
    const decision = gate.classify({ toolName: "git.commit", input: {}, linesDeleted: 201 });
    expect(decision).toEqual({ tier: "approval_required", reason: "large_deletion" });
  });
});
