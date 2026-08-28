# @maddox-bot/github

A GitHub client (fine-grained PAT auth via Octokit) and webhook HMAC signature verification.
**Read-only for now** — `getRepository`, `getPullRequest`, `getPullRequestDiff`,
`getPullRequestComments`, `getReviews`. Write operations (branch creation, push, PR creation,
comments, reviews) are added in increment 13 alongside the Implementation Agent that needs them.

## Design

`GitHubClient` depends on the narrow `OctokitLike` interface (`octokitLike.ts`), not on
`@octokit/rest`'s real (much larger) type surface — so its unit tests pass a plain object of
functions instead of mocking the real library. `createOctokitAdapter` (`octokitAdapter.ts`) is the
one place that touches real Octokit; it's thin by design and its own tests mock `@octokit/rest`
just enough to verify the parameter translation (`pull_number` vs. `pullNumber`, the diff media
type, etc.) is correct.

```
createGitHubClient(token) → GitHubClient(createOctokitAdapter(token))
```

## Webhook verification

`verifyGitHubWebhookSignature(secret, rawBody, signatureHeader)` checks the `X-Hub-Signature-256`
header via `@octokit/webhooks-methods`. It must run against the **raw** request body — the HTTP
layer that calls it (added in increment 7) needs to capture the raw bytes before any JSON parsing,
or verification will silently break.

## What this increment does _not_ need

No live GitHub credentials — every test here runs against mocks. A fine-grained PAT and a
disposable test repository are needed starting at increment 13, when write operations (and a real
PR) are added.
