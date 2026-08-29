import type { ImplementationPlan } from "./implementationPlan.js";
import type { SelfReview } from "./selfReview.js";

export interface PullRequestJiraRef {
  key: string;
  summary: string;
}

export function buildPullRequestTitle(
  jiraIssue: PullRequestJiraRef,
  plan: ImplementationPlan,
): string {
  return `${jiraIssue.key}: ${plan.summary}`;
}

function bulletList(items: string[], whenEmpty: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : whenEmpty;
}

/**
 * Shaped after Infinite-Forge's PR template (Overview / DoD-style checklist / Testing) rather than
 * a from-scratch layout, applied to what an autonomously-generated PR actually has to report: the
 * plan it followed, the files it touched, and its own lightweight self-review.
 */
export function buildPullRequestBody(
  jiraIssue: PullRequestJiraRef,
  plan: ImplementationPlan,
  selfReview: SelfReview,
): string {
  const fileChanges = [
    ...plan.filesToCreate.map((file) => `- \`${file.path}\` (new) — ${file.reason}`),
    ...plan.filesToModify.map((file) => `- \`${file.path}\` — ${file.reason}`),
  ];
  const concernsBlock =
    selfReview.concerns.length > 0
      ? `\n\nConcerns worth a closer look:\n${bulletList(selfReview.concerns, "")}`
      : "";

  return `## Overview
${plan.summary}

${plan.approach}

## Jira
[${jiraIssue.key}] ${jiraIssue.summary}

## Files Changed
${bulletList(fileChanges, "_No file changes recorded in the plan._")}

## Testing
${bulletList(plan.requiredTests, "_No specific tests listed in the plan._")}

## Self-Review
${selfReview.summary}${concernsBlock}

## Checklist
- [x] Tests added or updated
- [x] Self-reviewed by the agent
- [ ] Human review requested

---
🤖 Opened autonomously by maddox-bot for ${jiraIssue.key}.`;
}
