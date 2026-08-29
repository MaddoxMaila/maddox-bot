/**
 * The write-side counterpart to adfToPlainText.ts: Jira Cloud's REST API v3 requires rich-text
 * fields (comment bodies) as Atlassian Document Format, not plain strings. This produces the
 * minimal valid ADF for a plain-text comment — one paragraph per non-empty line — which is all
 * `jira.add_comment` needs. A comment that embeds an actual link (jira.link_pr) builds its own ADF
 * directly in JiraClient.linkPullRequest, since a real link mark isn't representable as plain text.
 */
export function textToAdf(text: string): unknown {
  const lines = text.split("\n").filter((line) => line.length > 0);
  return {
    type: "doc",
    version: 1,
    content:
      lines.length > 0
        ? lines.map((line) => ({
            type: "paragraph",
            content: [{ type: "text", text: line }],
          }))
        : [{ type: "paragraph" }],
  };
}
