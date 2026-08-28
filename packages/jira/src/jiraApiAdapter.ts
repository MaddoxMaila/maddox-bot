import type { JiraApiLike, RawJiraComment, RawJiraIssue } from "./jiraApiLike.js";

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export function createJiraApiAdapter(credentials: JiraCredentials): JiraApiLike {
  const baseUrl = credentials.baseUrl.replace(/\/+$/, "");
  const authHeader = `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64")}`;

  async function request<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Jira API request failed: ${response.status} ${response.statusText} (${path})`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async getIssue(issueKey) {
      return request<RawJiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
    },
    async getComments(issueKey) {
      const data = await request<{ comments: RawJiraComment[] }>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      );
      return data.comments;
    },
  };
}
