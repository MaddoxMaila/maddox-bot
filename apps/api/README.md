# @maddox-bot/api

Fastify app. Right now: two webhook receivers (increment 7). REST CRUD for sessions/tasks/approvals
and the WebSocket gateway are increment 15.

## `POST /webhooks/github`

Pipeline: verify `X-Hub-Signature-256` (HMAC, against the **raw** body — `fastify-raw-body` is
registered only on this route, since it's the only one that needs exact bytes) → normalize →
resolve the repository from `owner/repo` → determine relevance → persist a `ReceivedEvent` (a
repeated `X-GitHub-Delivery` short-circuits here as `{status: "duplicate"}`) → if relevant, enqueue
an `AgentTriggerJobPayload`.

Relevance (spec's own Phase 1 scope): only events on a pull request this platform already tracks
(`pull_requests` table) count — arbitrary inbound PR/push/issue events on an untracked repo, or a
PR we didn't create, are `relevant: false`. This closes our own loop (e.g. merged → mark a task
complete); it doesn't spawn new work from someone else's PR.

## `POST /webhooks/jira?token=...`

Jira Cloud's generic webhook feature has no HMAC header, so authentication is a shared-secret query
param instead. Pipeline: verify token → normalize → resolve the repository from the issue key's
project prefix (`repositories.jiraProjectKeys`) → evaluate relevance against that repository's
`agentTriggerConfig` (status transition / label added / assignee change, read from the webhook's
changelog — see `@maddox-bot/events`) → persist → enqueue if relevant.

## What "enqueue" does _not_ do yet

The queued `AgentTriggerJobPayload` is deliberately not a full `agent_task` row. Turning a relevant
Jira trigger into one (which needs a resolved/created `JiraIssue` and a Planner run) is agent-core
and the worker's job — increments 12 and 14. This route's job is event ingestion, not task
orchestration; see the plan's own scope for this increment.

## Local development

Needs the compose Postgres and Redis (`docker compose up -d` from the repo root). Tests default
`DATABASE_URL`/`REDIS_URL` to the compose instances via `@maddox-bot/database`'s and
`@maddox-bot/queue`'s `testDatabaseUrl`/`testRedisUrl` helpers.
