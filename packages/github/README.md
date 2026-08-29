# @maddox-bot/github

A GitHub client (fine-grained PAT auth via Octokit) and webhook HMAC signature verification.
Read operations since increment 5 — `getRepository`, `getPullRequest`, `getPullRequestDiff`,
`getPullRequestComments`, `getReviews`. Write operations since increment 13 —
`createPullRequest`, `commentOnPullRequest`. Branch creation and pushing are **not** here: they're
a git-protocol concept (`@maddox-bot/git`'s `GitClient.createBranch`/`push`) — pushing a new ref
_is_ how a branch comes to exist on GitHub, so there's no separate REST call to wrap.
Submitting a formal review isn't wired at all yet — see `@maddox-bot/permissions`, which keeps
`github.submit_review` `approval_required` pending a real review-delegation policy.

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

## What this package still doesn't need

No live GitHub credentials — every test here runs against a fake `OctokitLike`/mocked
`@octokit/rest`. A real fine-grained PAT and a disposable test repository are for whenever the
platform is actually pointed at a live repo end-to-end, not something this package's own tests
require.
