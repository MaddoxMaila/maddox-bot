import { createJiraApiAdapter, type JiraCredentials } from "./jiraApiAdapter.js";
import { JiraClient } from "./jiraClient.js";

export function createJiraClient(credentials: JiraCredentials): JiraClient {
  return new JiraClient(createJiraApiAdapter(credentials));
}
