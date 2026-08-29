# @maddox-bot/jira

A Jira Cloud REST v3 client (Basic auth via email + API token) and webhook token verification.
Read operations since increment 6 — `getIssue`, `getComments`. Write operations since
increment 13 — `addComment`, `transitionIssue`, `linkPullRequest`.

Uses Node's built-in `fetch` — no HTTP client dependency.

## Design

Mirrors `@maddox-bot/github`'s shape: `JiraClient` depends on the narrow `JiraApiLike` interface,
not on raw `fetch` calls, so its unit tests pass a plain object of functions.
`createJiraApiAdapter` is the one thin file that calls the real API.

```
createJiraClient({ baseUrl, email, apiToken }) → JiraClient(createJiraApiAdapter(...))
```

## ADF rendering

Jira Cloud's v3 API returns issue descriptions and comment bodies as **Atlassian Document
Format** — a JSON node tree, not plain text. `adfToPlainText` is a minimal renderer (paragraphs,
headings, bullet lists, hard breaks) — not a full ADF implementation — good enough to give the
Planner's LLM call readable text per the plan's assumption that acceptance criteria are parsed
from this field, not a dedicated custom field.

## Webhook verification

Jira Cloud's generic webhook feature has no built-in request-signing scheme like GitHub's HMAC
header. `verifyJiraWebhookToken` checks a shared-secret token instead (configured into the webhook
URL itself), using a constant-time comparison to avoid a timing side-channel on the secret.

## Writing: `textToAdf`, and why `transitionIssue` needs two calls

Jira Cloud's v3 API requires rich-text fields (comment bodies) as ADF, not plain strings —
`textToAdf.ts` is the write-side counterpart to `adfToPlainText`, producing the minimal valid ADF
for a plain-text comment (one paragraph per non-empty line). `linkPullRequest` builds its own ADF
directly instead, with a real `link` mark, since a plain-text URL doesn't render as clickable in
Jira.

There is no "set status directly" REST call. `transitionIssue(issueKey, targetStatus)` first calls
`GET .../transitions` to look up the transition **id** for the target status name, then submits
that id — transitions (and their ids) are configured per-workflow and aren't stable across
projects, so the id can't be guessed or cached across issues.

## What this package still doesn't need

No live Jira credentials — every test here mocks `fetch`. A real Jira Cloud site and API token are
for whenever the platform is actually pointed at a live project end-to-end, not something this
package's own tests require.
