export { computeDedupeKey } from "./dedupeKey.js";
export {
  evaluateGitHubRelevance,
  normalizeGitHubEvent,
  type GitHubWebhookPayload,
} from "./githubEvents.js";
export {
  evaluateJiraRelevance,
  normalizeJiraEvent,
  type JiraTriggerConfig,
  type JiraWebhookPayload,
} from "./jiraEvents.js";
export type { NormalizedEventCore, RelevanceResult } from "./normalizedEvent.js";
export { parseJiraTriggerConfig } from "./parseJiraTriggerConfig.js";
