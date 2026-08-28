# @maddox-bot/jira

A Jira Cloud REST v3 client (Basic auth via email + API token) and webhook token verification.
**Read-only for now** — `getIssue`, `getComments`. Write operations (`updateIssue`, `addComment`,
`linkPr`) are added in increment 13 alongside the Implementation Agent that needs them.

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

## What this increment does _not_ need

No live Jira credentials — every test here mocks `fetch`. A real Jira Cloud site and API token are
needed starting at increment 13, when write operations are added.
