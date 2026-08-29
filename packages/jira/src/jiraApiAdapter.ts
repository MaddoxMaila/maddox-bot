import type {
  JiraApiLike,
  RawJiraComment,
  RawJiraIssue,
  RawJiraTransition,
} from "./jiraApiLike.js";

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function issuePath(issueKey: string): string {
  return `/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
}

export function createJiraApiAdapter(credentials: JiraCredentials): JiraApiLike {
  const baseUrl = credentials.baseUrl.replace(/\/+$/, "");
  const authHeader = `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64")}`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: authHeader,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Jira API request failed: ${response.status} ${response.statusText} (${path})`,
      );
    }
    // Jira's write endpoints (e.g. POST .../transitions) return 204 No Content on success —
    // .json() would throw on the empty body, and there's nothing meaningful to parse anyway.
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    async getIssue(issueKey) {
      return request<RawJiraIssue>(issuePath(issueKey));
    },
    async getComments(issueKey) {
      const data = await request<{ comments: RawJiraComment[] }>(`${issuePath(issueKey)}/comment`);
      return data.comments;
    },
    async addComment(issueKey, body) {
      await request(`${issuePath(issueKey)}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
    },
    async getTransitions(issueKey) {
      const data = await request<{ transitions: RawJiraTransition[] }>(
        `${issuePath(issueKey)}/transitions`,
      );
      return data.transitions;
    },
    async postTransition(issueKey, transitionId) {
      await request(`${issuePath(issueKey)}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transition: { id: transitionId } }),
      });
    },
  };
}
