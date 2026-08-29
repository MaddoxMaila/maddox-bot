import { describe, expect, it } from "vitest";
import { evaluateGitHubRelevance, normalizeGitHubEvent } from "./githubEvents.js";

describe("normalizeGitHubEvent", () => {
  it("combines event type and action for events that have one", () => {
    const event = normalizeGitHubEvent("pull_request", "delivery-1", {
      action: "opened",
      repository: { full_name: "octocat/hello-world" },
    });
    expect(event.eventType).toBe("github.pull_request.opened");
    expect(event.source).toBe("github");
    expect(event.sourceEventId).toBe("delivery-1");
  });

  it("omits the action segment for events without one", () => {
    const event = normalizeGitHubEvent("push", "delivery-2", {
      repository: { full_name: "octocat/hello-world" },
    });
    expect(event.eventType).toBe("github.push");
    expect(event.payload).toEqual({});
  });

  it("extracts PR number and branch into externalRefs when a pull_request is present", () => {
    const event = normalizeGitHubEvent("pull_request", "delivery-3", {
      action: "synchronize",
      pull_request: { number: 42, head: { ref: "feature/x" } },
      repository: { full_name: "octocat/hello-world" },
    });
    expect(event.externalRefs).toEqual({
      repoFullName: "octocat/hello-world",
      prNumber: 42,
      branch: "feature/x",
    });
  });

  it("omits PR fields from externalRefs when there is no pull_request", () => {
    const event = normalizeGitHubEvent("push", "delivery-4", {
      repository: { full_name: "octocat/hello-world" },
    });
    expect(event.externalRefs).toEqual({ repoFullName: "octocat/hello-world" });
  });

  it("captures merged in the payload when the pull_request carries it", () => {
    const merged = normalizeGitHubEvent("pull_request", "delivery-6", {
      action: "closed",
      pull_request: { number: 42, head: { ref: "feature/x" }, merged: true },
      repository: { full_name: "octocat/hello-world" },
    });
    expect(merged.payload).toEqual({ action: "closed", merged: true });

    const closedUnmerged = normalizeGitHubEvent("pull_request", "delivery-7", {
      action: "closed",
      pull_request: { number: 42, head: { ref: "feature/x" }, merged: false },
      repository: { full_name: "octocat/hello-world" },
    });
    expect(closedUnmerged.payload).toEqual({ action: "closed", merged: false });
  });

  it("produces the same dedupeKey for the same delivery id", () => {
    const payload = { repository: { full_name: "octocat/hello-world" } };
    const first = normalizeGitHubEvent("push", "delivery-5", payload);
    const second = normalizeGitHubEvent("push", "delivery-5", payload);
    expect(first.dedupeKey).toBe(second.dedupeKey);
  });
});

describe("evaluateGitHubRelevance", () => {
  it("is relevant when the PR is one the platform created", () => {
    expect(evaluateGitHubRelevance({ isTrackedPullRequest: true })).toEqual({
      isRelevant: true,
      reason: "event_on_platform_created_pull_request",
    });
  });

  it("is not relevant for an untracked pull request", () => {
    expect(evaluateGitHubRelevance({ isTrackedPullRequest: false })).toEqual({
      isRelevant: false,
      reason: "not_a_platform_created_pull_request",
    });
  });
});
