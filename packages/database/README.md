# @maddox-bot/database

Prisma schema, migrations, and repository classes. **The only package in this monorepo that
imports `@prisma/client`** — everything else depends on `Database` and the plain TypeScript
record/input types this package exports.

## Schema

`prisma/schema.prisma` defines all 17 entities from the approved plan (organizations, users,
repositories, integrations, agent sessions/tasks/messages, task events, tool calls/results,
workspaces, approvals, pull requests, jira issues, artifacts, audit logs, notifications).

Two deliberate departures from a naive one-to-one translation of the plan's table list, both to
avoid a redundant bidirectional foreign key describing the same edge twice:

- `pull_requests.task_id` and `workspaces.task_id` are the real (unique) foreign keys.
  `AgentTask.pullRequest` / `AgentTask.workspace` are reverse relations, not separate columns.
- `tool_calls.approval_id` is the real (unique) foreign key. `Approval.toolCall` is a reverse
  relation — null for `plan_approval`s, which aren't tied to any specific tool call.

`agent_tasks.state` is a plain string column, not a native Postgres enum: the vocabulary is owned
by `@maddox-bot/shared`'s `TaskState` union (see `ADR-0001`), which is expected to grow new values
in later phases. A native enum would need a schema migration for every addition; the repository
layer validates with `isTaskState` on the way out of the database instead, and throws if it ever
finds a value that isn't a recognized `TaskState` (that would mean something wrote to the column
outside this repository).

Increment 7 added one table beyond the original 17: `received_events`, the durability half of the
event pipeline's two-layer dedupe (BullMQ's `jobId` is the other). It has no FK constraints to
`organizations`/`repositories` on purpose — a webhook can legitimately arrive for a repo nothing
maps to yet, and it should still be recorded (`isRelevant: false`, a specific reason) rather than
fail.

## What's implemented vs. deferred

`Database` wires up nine repositories: `organizations`, `repositories`, `agentTasks`,
`pullRequests`, `receivedEvents`, `taskEvents`, `toolCalls`, `jiraIssues`, `approvals`. Each
repository class was added in the increment that actually needed it, not predicted in advance —
several landed earlier or later than a first guess at the schedule would have suggested:

- `PullRequestRepository` was pulled forward to increment 7, read-only
  (`findByRepositoryAndProviderNumber`), because that increment's GitHub event relevance check ("is
  this PR one the platform created?") needed it immediately. `create`/`findByTaskId` didn't arrive
  until increment 13 (real PR creation) and increment 14 (the worker's crash-recovery check,
  "does a PR already exist for this task?") respectively.
- `TaskEventRepository`/`ToolCallRepository` arrived in increment 12 alongside `agent-core`'s
  `TaskStateMachine`/`AgentLoopRunner` — the first things that needed an audit trail to write to.
- `JiraIssueRepository` arrived in increment 14 (the worker), not increment 13 as a much earlier
  guess at the schedule had it — the Implementation Agent (increment 13) only ever _reads_ a
  Jira issue's key/summary, already passed in by its caller; nothing needed to persist Jira's
  current issue state until the worker had to resolve a webhook event into a real task.
- `AgentTaskRepository.findByReceivedEventId` (increment 14) exists specifically to make task
  creation idempotent against BullMQ's own automatic job retries — see `apps/worker`'s README for
  why that's a different problem from a worker _process_ crashing.
- `ApprovalRepository` arrived in increment 15, alongside `apps/api`'s approval endpoints — its
  `decide()` throws two distinct `Error` subclasses (`ApprovalNotFoundError`,
  `ApprovalAlreadyDecidedError`) rather than one generic `Error` with different messages, after a
  real bug: Prisma's own errors render a source-code snippet around the failing call, which can
  _contain_ an unrelated substring a caller's `message.includes(...)` check would false-positive
  on. See `apps/api`'s README for the specific case that surfaced it. Only `plan_approval` has a
  real writer (`apps/worker`'s `taskRunner.ts`) — `tool_approval` rows are never created; a tool
  that unexpectedly needs approval still resolves through the worker's `denyWithoutHuman()`
  safe-default.

`WorkspaceRepository` still doesn't exist — nothing persists workspace status yet (see
`apps/worker`'s README for exactly what that's waiting on). Its table already exists from
increment 3's migration, so adding that class later needs no further schema change.

## Local development

```bash
docker compose up -d               # from the repo root — starts Postgres on localhost:5433
pnpm --filter @maddox-bot/database db:migrate   # create/apply a migration after schema changes
```

Tests default `DATABASE_URL` to the compose instance (`postgresql://maddox:maddox@localhost:5433/maddox_bot`)
if it isn't already set — see `src/testDatabaseUrl.ts`.
