interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

function renderNode(node: AdfNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  const children = (node.content ?? []).map(renderNode).join("");
  if (node.type === "listItem") {
    return `- ${children}\n`;
  }
  if (node.type === "paragraph" || node.type === "heading") {
    return `${children}\n`;
  }
  return children;
}

/**
 * Jira Cloud's REST API v3 returns rich text (issue descriptions, comment bodies) as Atlassian
 * Document Format — a JSON node tree, not plain text. This isn't a full ADF renderer; it's just
 * enough (paragraphs, headings, lists, line breaks) to give the Planner's LLM call something
 * readable, per the plan's assumption that acceptance criteria are parsed from this text.
 */
export function adfToPlainText(doc: unknown): string {
  if (doc === null || typeof doc !== "object") {
    return "";
  }
  return renderNode(doc as AdfNode)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}
