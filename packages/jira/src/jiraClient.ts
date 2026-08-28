import { adfToPlainText } from "./adfToPlainText.js";
import type { JiraApiLike } from "./jiraApiLike.js";

export interface JiraIssueInfo {
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string | null;
  labels: string[];
}

export interface JiraCommentInfo {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

/** Read-only for now (increment 6); updateIssue/addComment/linkPr land in increment 13. */
export class JiraClient {
  constructor(private readonly api: JiraApiLike) {}

  async getIssue(issueKey: string): Promise<JiraIssueInfo> {
    const raw = await this.api.getIssue(issueKey);
    return {
      key: raw.key,
      summary: raw.fields.summary,
      description: adfToPlainText(raw.fields.description),
      status: raw.fields.status.name,
      assignee: raw.fields.assignee?.displayName ?? null,
      labels: raw.fields.labels,
    };
  }

  async getComments(issueKey: string): Promise<JiraCommentInfo[]> {
    const raw = await this.api.getComments(issueKey);
    return raw.map((comment) => ({
      id: comment.id,
      author: comment.author.displayName,
      body: adfToPlainText(comment.body),
      createdAt: comment.created,
    }));
  }
}
