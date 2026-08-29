function kebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Interpolates a repository's `branchNamingTemplate` (e.g. "feature/<jira-key>-<kebab-summary>")
 * — agent-core deliberately doesn't own this policy (see its README), so it lives with the other
 * pre-computed-input assembly the worker is responsible for. */
export function buildBranchName(template: string, jiraKey: string, summary: string): string {
  return template
    .replace("<jira-key>", jiraKey.toLowerCase())
    .replace("<kebab-summary>", kebabCase(summary));
}
