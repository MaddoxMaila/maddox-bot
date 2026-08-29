import type { PermissionCheckInput, PermissionDecision } from "./types.js";

export interface PermissionGateOptions {
  protectedBranches?: string[];
  largeDeletionLineThreshold?: number;
  sensitivePathPatterns?: RegExp[];
}

const DEFAULT_PROTECTED_BRANCHES = ["main", "master"];
const DEFAULT_LARGE_DELETION_LINE_THRESHOLD = 200;
const DEFAULT_SENSITIVE_PATH_PATTERNS = [/^\.github\/workflows\//, /^infra\//i, /migrations?\//i];

// Anchored to the start of the command so "npm run install-deps" (a script name, not an install)
// doesn't false-positive; still catches the command appearing after a shell operator (&&, ;, |).
// Deliberately over-inclusive (e.g. "gem add" isn't a real command but would still match) rather
// than enumerating each tool's exact verb set — a false positive only asks for an approval that
// wasn't strictly needed, never the reverse.
const DEPENDENCY_INSTALL_PATTERN =
  /(^|[;&|]\s*)(?:npm|pnpm|yarn|pip|gem|cargo)\s+(?:install|add|i)\b/i;

// Every read tool, plus the routine write actions of an already-authorized task (spec §20's own
// framing: gate the unusual, not the expected deliverables of a task that's already running).
// No "github.create_branch": branches are a git-protocol concept, not a GitHub REST one — pushing
// a new ref *is* how a branch comes to exist on GitHub, so git.create_branch + git.push cover it
// and there's no separate REST call to gate.
const SAFE_TOOLS = new Set([
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
]);

// Not in the plan's original safe-tier table — submitting a review under a delegated identity is
// exactly the impersonation-adjacent action spec §15 is cautious about, and it isn't wired to
// anything until Phase 2 designs the real review-delegation policy. Conservative default now
// rather than an unreviewed decision made by omission later.
const APPROVAL_REQUIRED_TOOLS = new Set(["github.submit_review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class PermissionGate {
  private readonly protectedBranches: Set<string>;
  private readonly largeDeletionLineThreshold: number;
  private readonly sensitivePathPatterns: RegExp[];

  constructor(options: PermissionGateOptions = {}) {
    this.protectedBranches = new Set(options.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES);
    this.largeDeletionLineThreshold =
      options.largeDeletionLineThreshold ?? DEFAULT_LARGE_DELETION_LINE_THRESHOLD;
    this.sensitivePathPatterns = options.sensitivePathPatterns ?? DEFAULT_SENSITIVE_PATH_PATTERNS;
  }

  classify(check: PermissionCheckInput): PermissionDecision {
    if (SAFE_TOOLS.has(check.toolName)) {
      return { tier: "safe", reason: "routine_action_of_an_authorized_task" };
    }
    if (APPROVAL_REQUIRED_TOOLS.has(check.toolName)) {
      return {
        tier: "approval_required",
        reason: "not_yet_governed_by_a_review_delegation_policy",
      };
    }

    switch (check.toolName) {
      case "shell.run":
        return this.classifyShellRun(check.input);
      case "repo.write_file":
        return this.classifyRepoWriteFile(check.input);
      case "git.push":
      case "github.push":
        return this.classifyPush(check.input);
      case "git.commit":
        return this.classifyCommit(check);
      default:
        // Fail closed: an unrecognized tool name is exactly the "escape hatch beyond the named
        // tools" that least privilege says should be gated, not silently allowed.
        return { tier: "approval_required", reason: "unrecognized_tool" };
    }
  }

  private classifyShellRun(input: unknown): PermissionDecision {
    const command =
      isRecord(input) && typeof input.command === "string" ? input.command : undefined;
    if (command !== undefined && DEPENDENCY_INSTALL_PATTERN.test(command)) {
      return { tier: "approval_required", reason: "dependency_install" };
    }
    return { tier: "approval_required", reason: "unrecognized_shell_command" };
  }

  private classifyRepoWriteFile(input: unknown): PermissionDecision {
    const path = isRecord(input) && typeof input.path === "string" ? input.path : undefined;
    if (path === undefined) {
      return { tier: "approval_required", reason: "malformed_input" };
    }
    if (this.sensitivePathPatterns.some((pattern) => pattern.test(path))) {
      return { tier: "approval_required", reason: "sensitive_path" };
    }
    return { tier: "safe", reason: "routine_action_of_an_authorized_task" };
  }

  private classifyPush(input: unknown): PermissionDecision {
    if (!isRecord(input) || typeof input.branch !== "string") {
      return { tier: "approval_required", reason: "malformed_input" };
    }
    if (input.force === true) {
      return { tier: "approval_required", reason: "force_push" };
    }
    if (this.protectedBranches.has(input.branch)) {
      return { tier: "human_only", reason: "protected_branch" };
    }
    return { tier: "safe", reason: "routine_action_of_an_authorized_task" };
  }

  private classifyCommit(check: PermissionCheckInput): PermissionDecision {
    if (check.linesDeleted !== undefined && check.linesDeleted > this.largeDeletionLineThreshold) {
      return { tier: "approval_required", reason: "large_deletion" };
    }
    return { tier: "safe", reason: "routine_action_of_an_authorized_task" };
  }
}
