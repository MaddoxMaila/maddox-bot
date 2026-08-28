import { GitHubClient } from "./githubClient.js";
import { createOctokitAdapter } from "./octokitAdapter.js";

export function createGitHubClient(token: string): GitHubClient {
  return new GitHubClient(createOctokitAdapter(token));
}
