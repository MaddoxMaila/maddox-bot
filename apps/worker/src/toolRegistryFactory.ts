import {
  createGitHubReadTools,
  createGitHubWriteTools,
  createGitReadTools,
  createGitWriteTools,
  createJiraReadTools,
  createJiraWriteTools,
  createRepoReadTools,
  createRepoWriteTools,
  createShellTools,
  ToolRegistry,
} from "@maddox-bot/agent-tools";
import type { GitClient } from "@maddox-bot/git";
import type { GitHubClient } from "@maddox-bot/github";
import type { JiraClient } from "@maddox-bot/jira";
import type { Sandbox } from "@maddox-bot/sandbox";

/** Read tools only — this is where agent-core's own README says a role's toolset gets assembled
 * from real clients with live config. */
export function buildPlannerToolRegistry(
  gitClient: GitClient,
  baseDir: string,
  githubClient: GitHubClient,
  jiraClient: JiraClient,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createRepoReadTools(baseDir),
    ...createGitReadTools(gitClient),
    ...createGitHubReadTools(githubClient),
    ...createJiraReadTools(jiraClient),
  ]) {
    registry.register(tool);
  }
  return registry;
}

/** Read + write tools, including shell.run_* (needs the sandbox) — the Implementation Agent's full
 * toolset. */
export function buildImplementationToolRegistry(
  gitClient: GitClient,
  baseDir: string,
  sandbox: Sandbox,
  githubClient: GitHubClient,
  jiraClient: JiraClient,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createRepoReadTools(baseDir),
    ...createRepoWriteTools(baseDir),
    ...createGitReadTools(gitClient),
    ...createGitWriteTools(gitClient),
    ...createShellTools(sandbox, baseDir),
    ...createGitHubReadTools(githubClient),
    ...createGitHubWriteTools(githubClient),
    ...createJiraReadTools(jiraClient),
    ...createJiraWriteTools(jiraClient),
  ]) {
    registry.register(tool);
  }
  return registry;
}
