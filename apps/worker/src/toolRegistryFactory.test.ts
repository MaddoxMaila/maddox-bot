import type { GitClient } from "@maddox-bot/git";
import type { GitHubClient } from "@maddox-bot/github";
import type { JiraClient } from "@maddox-bot/jira";
import type { Sandbox } from "@maddox-bot/sandbox";
import { describe, expect, it } from "vitest";
import {
  buildImplementationToolRegistry,
  buildPlannerToolRegistry,
} from "./toolRegistryFactory.js";

const fakeGitClient = {} as GitClient;
const fakeGitHubClient = {} as GitHubClient;
const fakeJiraClient = {} as JiraClient;
const fakeSandbox = {} as Sandbox;

describe("buildPlannerToolRegistry", () => {
  it("registers only read tools", () => {
    const registry = buildPlannerToolRegistry(
      fakeGitClient,
      "/tmp/repo",
      fakeGitHubClient,
      fakeJiraClient,
    );

    const names = registry.list().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "repo.search",
        "repo.read_file",
        "git.status",
        "github.get_repository",
        "jira.get_issue",
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(["repo.write_file", "git.commit", "shell.run_tests"]),
    );
  });
});

describe("buildImplementationToolRegistry", () => {
  it("registers both read and write tools, including shell checks", () => {
    const registry = buildImplementationToolRegistry(
      fakeGitClient,
      "/tmp/repo",
      fakeSandbox,
      fakeGitHubClient,
      fakeJiraClient,
    );

    const names = registry.list().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "repo.read_file",
        "repo.write_file",
        "git.status",
        "git.commit",
        "git.push",
        "shell.run_tests",
        "github.create_pr",
        "jira.link_pr",
      ]),
    );
  });
});
