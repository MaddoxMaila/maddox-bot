# @maddox-bot/api

Fastify app: two webhook receivers (increment 7), read-only task/approval REST endpoints, an
approval-decision endpoint, and a polling WebSocket gateway (increment 15). Session CRUD and the
VS Code extension's own auth are still increment 16.

## `POST /webhooks/github`

Pipeline: verify `X-Hub-Signature-256` (HMAC, against the **raw** body — `fastify-raw-body` is
registered only on this route, since it's the only one that needs exact bytes) → normalize →
resolve the repository from `owner/repo` → determine relevance → persist a `ReceivedEvent` (a
repeated `X-GitHub-Delivery` short-circuits here as `{status: "duplicate"}`) → if relevant, enqueue
an `AgentTriggerJobPayload`.

Relevance (spec's own Phase 1 scope): only events on a pull request this platform already tracks
(`pull_requests` table) count — arbitrary inbound PR/push/issue events on an untracked repo, or a
PR we didn't create, are `relevant: false`. This closes our own loop (e.g. merged → mark a task
complete) — though the worker doesn't actually act on a GitHub-sourced job yet; see
`apps/worker`'s README.

## `POST /webhooks/jira?token=...`

Jira Cloud's generic webhook feature has no HMAC header, so authentication is a shared-secret query
param instead. Pipeline: verify token → normalize → resolve the repository from the issue key's
project prefix (`repositories.jiraProjectKeys`) → evaluate relevance against that repository's
`agentTriggerConfig` (status transition / label added / assignee change, read from the webhook's
changelog — see `@maddox-bot/events`) → persist → enqueue if relevant.

The queued `AgentTriggerJobPayload` is deliberately not a full `agent_task` row — resolving a
relevant Jira trigger into one (fetching the issue, upserting a `JiraIssue`, creating the task) is
`apps/worker`'s job, not event ingestion's.

## `GET /tasks`, `/tasks/:id`, `/tasks/:id/events`, `/tasks/:id/tool-calls`, `/tasks/:id/approvals`

Read-only. `GET /tasks` requires a `repositoryId` query parameter rather than listing across the
whole system — the only client so far (a VS Code extension working in one open repository) never
needs a cross-repository view, and `AgentTaskRepository` has no such query either.

## `GET /approvals` and `POST /approvals/:id/decide`

`GET /approvals` always returns pending ones — that's the only view a human deciding approvals
actually needs; a task's full approval history is `GET /tasks/:id/approvals` instead.

Deciding an approval **only records the decision and nudges the worker** — this route never runs
agent-core itself, and doesn't know or care whether the outcome is "implement the plan" or "cancel
the task" (a denied `plan_approval` cancels — see `apps/worker`'s taskRunner.ts). It:

1. Calls `ApprovalRepository.decide()`, which throws `ApprovalNotFoundError` (→ 404) or
   `ApprovalAlreadyDecidedError` (→ 409) for the two expected failure modes.
2. Enqueues `{ taskId }` onto `taskResumeQueue` — a separate BullMQ queue from
   `agentTriggerQueue`, only ever enqueued here and only ever consumed by the worker calling
   `runTask(taskId)` again, the exact same dispatch a crash-recovery or a fresh task goes through.

**A real bug this surfaced**: the first version of this route distinguished 404 vs. 409 by
`error.message.includes(...)`. Prisma's own thrown errors render a source-code context snippet
around the failing call — which can _contain_ an unrelated substring a naive text match will
false-positive on (in this case, literally the words "already decided" from a comment/branch two
lines above the throwing call in `approvalRepository.ts`, echoed back in Prisma's own error
formatting). `ApprovalRepository.decide()` now throws two distinct `Error` subclasses instead, and
this route checks `instanceof` — a genuinely different failure (e.g. a malformed `decidedBy` that
isn't a real `users.id`) now correctly surfaces as a 500, not a misleading 409.

## `GET /tasks/:id/stream` (WebSocket)

Polling behind a WebSocket, not Redis pub/sub from the worker. The worker is a separate process
writing `task_events` directly to Postgres; wiring a publish call into every one of agent-core's
scattered task-event write sites (`TaskStateMachine`, `AgentLoopRunner`,
`ImplementationAgentRunner`, ...) is a cross-cutting concern that's easy to miss at a new call site
later. A short poll (`routes/taskStream.ts`, 2s by default) keeps this package, agent-core, and the
database layer completely unaware of who's listening, at the cost of up to one poll interval of
latency — imperceptible for a human watching a task's progress. On connect it sends an immediate
snapshot (current state + every existing event), then only new events plus the current state on
each subsequent tick that actually changed something. Redis pub/sub (already a dependency, for
BullMQ) is the natural upgrade path if that latency ever actually matters.

## Local development

Needs the compose Postgres and Redis (`docker compose up -d` from the repo root). Tests default
`DATABASE_URL`/`REDIS_URL` to the compose instances via `@maddox-bot/database`'s and
`@maddox-bot/queue`'s `testDatabaseUrl`/`testRedisUrl` helpers.
