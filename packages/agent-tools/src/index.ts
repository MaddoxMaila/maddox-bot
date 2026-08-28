export {
  detectProjectCommand,
  type DetectedCommand,
  type PackageManager,
  type ProjectScript,
} from "./projectToolingDetector.js";
export { createGitReadTools } from "./tools/gitTools.js";
export { createGitHubReadTools } from "./tools/githubTools.js";
export { createJiraReadTools } from "./tools/jiraTools.js";
export { createRepoTools } from "./tools/repoTools.js";
export { createShellTools } from "./tools/shellTools.js";
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionOutcome,
  ToolResult,
} from "./toolDefinition.js";
export { ToolRegistry } from "./toolRegistry.js";
