# tests/e2e

The Phase 1 end-to-end scenario (increment 17, plan section 8's final row): a real Jira issue
drives the full pipeline through to a real opened GitHub PR, asserting every intermediate task
state transition. The actual test lives at
[`apps/worker/src/livePipeline.e2e.test.ts`](../../apps/worker/src/livePipeline.e2e.test.ts) —
co-located there (not in this directory) because it needs the same internal functions
(`handleAgentTriggerJob`, `requireTask`, `WorkerDependencies`) increment 14's own
`workerPipeline.endToEnd.test.ts` already imports by relative path, and `apps/worker` isn't set up
as a library another package can import from. This directory holds the fixture content and this
setup guide instead.

Every other test in this repo either mocks GitHub/Jira/Anthropic or runs against local infra
(Postgres, Redis, Docker) — this is the one place that actually calls the real internet. It's part
of `apps/worker`'s normal `pnpm test` run, but **skips cleanly (not a failure) whenever the
credentials below aren't set** — so it's always safe to leave in, and nothing about the rest of
this repo's test suite depends on it ever running.

## One-time setup

1. **A disposable GitHub repository**, used for nothing else. Push
   [`tests/fixtures/sample-repo`](../fixtures/sample-repo)'s content to its `main` branch once:
   ```bash
   cp -r tests/fixtures/sample-repo /tmp/maddox-bot-e2e-repo
   cd /tmp/maddox-bot-e2e-repo
   git init -b main && git add -A && git commit -m "chore: initial commit"
   git remote add origin https://github.com/<owner>/<repo>.git
   git push -u origin main
   ```
   The test only ever pushes new feature branches and opens PRs against this repo — it never
   force-pushes or otherwise touches `main` itself, so this is a one-time step, not something to
   redo before every run. Repeated runs do accumulate feature branches/PRs on this repo over time;
   clean those up by hand occasionally since nothing here does it automatically.
2. **A fine-grained GitHub PAT** scoped to just that repository, with Contents (read/write) and
   Pull requests (read/write) permissions.
3. **A Jira Cloud site** with a project, and **one real issue in it** describing a small, concrete
   task matching the fixture — e.g. "Add a `subtract` function alongside the existing `add`," so
   whatever the real model plans and implements has an obvious, checkable answer. Note its issue
   key (e.g. `PROJ-1`).
4. **A Jira API token** for that site (an ordinary user's token — the same credential shape
   `apps/worker`'s own `JIRA_API_TOKEN` uses).
5. **An Anthropic API key.**

## Environment variables

| Variable                                        | Meaning                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                             | Real key — the Planner and Implementation Agent run for real, unscripted. |
| `GITHUB_TOKEN`                                  | The fine-grained PAT from step 2.                                         |
| `E2E_GITHUB_OWNER`, `E2E_GITHUB_REPO`           | The disposable repo from step 1.                                          |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | The Jira Cloud site and token from steps 3–4.                             |
| `E2E_JIRA_ISSUE_KEY`                            | The real issue key from step 3.                                           |

Run it directly once all eight are set:

```bash
ANTHROPIC_API_KEY=... GITHUB_TOKEN=... E2E_GITHUB_OWNER=... E2E_GITHUB_REPO=... \
JIRA_BASE_URL=... JIRA_EMAIL=... JIRA_API_TOKEN=... E2E_JIRA_ISSUE_KEY=PROJ-1 \
pnpm --filter @maddox-bot/worker test -- livePipeline
```

## What it asserts, and what it can't

Because the LLM calls are real (not scripted, unlike every other test in this repo), the test can't
assert exact file contents or an exact state-transition sequence — the Implementation Agent's real
fix-retry loop (`TESTING` ⇄ `FIXING`) may run zero or more times depending on what the model
actually produces first. It asserts the deterministic prefix
(`CREATED → ANALYZING → PLANNED → AWAITING_APPROVAL → IMPLEMENTING → TESTING`) and suffix
(`SELF_REVIEW → PR_CREATED → AWAITING_HUMAN_REVIEW`) around that loop, that nothing outside
`{TESTING, FIXING}` appears inside it, that a real `pull_requests` row exists with a URL pointing at
the real repo, and that the real Jira issue received a comment linking that PR. A 10-minute timeout
accounts for real network latency and real model inference time, not the seconds a scripted-LLM
test takes.
