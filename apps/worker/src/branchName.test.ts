import { describe, expect, it } from "vitest";
import { buildBranchName } from "./branchName.js";

describe("buildBranchName", () => {
  it("interpolates the jira key and a kebab-cased summary", () => {
    expect(
      buildBranchName("feature/<jira-key>-<kebab-summary>", "PROJ-481", "Add password reset"),
    ).toBe("feature/proj-481-add-password-reset");
  });

  it("strips punctuation and collapses runs of separators", () => {
    expect(buildBranchName("<kebab-summary>", "PROJ-1", "Fix: the `foo()` bug!!")).toBe(
      "fix-the-foo-bug",
    );
  });

  it("truncates a very long summary rather than producing an unbounded branch name", () => {
    const longSummary = "a".repeat(200);
    const branch = buildBranchName("<kebab-summary>", "PROJ-1", longSummary);
    expect(branch.length).toBeLessThanOrEqual(50);
  });
});
