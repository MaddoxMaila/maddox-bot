// Mirrors packages/github's OctokitLike pattern: a narrow, purpose-built interface JiraClient
// depends on, so its unit tests pass a plain object of functions instead of mocking `fetch`.

export interface RawJiraIssue {
  key: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string };
    assignee: { displayName: string } | null;
    labels: string[];
  };
}

export interface RawJiraComment {
  id: string;
  author: { displayName: string };
  body: unknown;
  created: string;
}

export interface JiraApiLike {
  getIssue(issueKey: string): Promise<RawJiraIssue>;
  getComments(issueKey: string): Promise<RawJiraComment[]>;
}
