import { describe, expect, it } from "vitest";
import { buildPlannerContext } from "./contextBuilder.js";

const baseInput = {
  jiraIssue: {
    key: "PROJ-481",
    summary: "Add a health check endpoint",
    description: "We need a /health route for the load balancer.",
    status: "AI READY",
  },
  repository: { owner: "acme", name: "widgets", defaultBranch: "main" },
};

describe("buildPlannerContext", () => {
  it("embeds the Jira issue and repository in the system prompt", () => {
    const { system } = buildPlannerContext(baseInput);

    expect(system).toContain("PROJ-481");
    expect(system).toContain("Add a health check endpoint");
    expect(system).toContain("We need a /health route for the load balancer.");
    expect(system).toContain("acme/widgets");
    expect(system).toContain("main");
  });

  it("omits the acceptance criteria and conventions blocks when absent", () => {
    const { system } = buildPlannerContext(baseInput);

    expect(system).not.toContain("Acceptance criteria");
    expect(system).not.toContain("Repository conventions");
  });

  it("includes acceptance criteria as a bulleted list when present", () => {
    const { system } = buildPlannerContext({
      ...baseInput,
      jiraIssue: {
        ...baseInput.jiraIssue,
        acceptanceCriteria: ["Returns 200", "No auth required"],
      },
    });

    expect(system).toContain("Acceptance criteria:");
    expect(system).toContain("- Returns 200");
    expect(system).toContain("- No auth required");
  });

  it("includes repository conventions when provided", () => {
    const { system } = buildPlannerContext({
      ...baseInput,
      conventions: "Use Conventional Commits.",
    });

    expect(system).toContain("Repository conventions:");
    expect(system).toContain("Use Conventional Commits.");
  });

  it("opens the conversation with a single user message inviting investigation", () => {
    const { messages } = buildPlannerContext(baseInput);

    expect(messages).toEqual([
      { role: "user", content: "Begin your investigation and propose an implementation plan." },
    ]);
  });
});
