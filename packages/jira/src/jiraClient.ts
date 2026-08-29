import { adfToPlainText } from "./adfToPlainText.js";
import type { JiraApiLike } from "./jiraApiLike.js";
import { textToAdf } from "./textToAdf.js";

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

export interface JiraPullRequestRef {
  url: string;
  title: string;
}

/** Read operations since increment 6; addComment/transitionIssue/linkPullRequest land in increment 13. */
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

  async addComment(issueKey: string, body: string): Promise<void> {
    await this.api.addComment(issueKey, textToAdf(body));
  }

  /**
   * Jira Cloud's REST API has no "set status directly" call — a transition must first be looked
   * up by its target status name (transitions are configured per-workflow, so their ids aren't
   * stable across projects) and then submitted by id.
   */
  async transitionIssue(issueKey: string, targetStatus: string): Promise<void> {
    const transitions = await this.api.getTransitions(issueKey);
    const match = transitions.find(
      (transition) => transition.to.name.toLowerCase() === targetStatus.toLowerCase(),
    );
    if (!match) {
      const available = transitions.map((transition) => transition.to.name).join(", ");
      throw new Error(
        `No transition to "${targetStatus}" is available for ${issueKey} (available: ${available})`,
      );
    }
    await this.api.postTransition(issueKey, match.id);
  }

  /** A real ADF link mark, not markdown — a plain-text link doesn't render as clickable in Jira. */
  async linkPullRequest(issueKey: string, pr: JiraPullRequestRef): Promise<void> {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Pull request opened: " },
            { type: "text", text: pr.title, marks: [{ type: "link", attrs: { href: pr.url } }] },
          ],
        },
      ],
    };
    await this.api.addComment(issueKey, adf);
  }
}
