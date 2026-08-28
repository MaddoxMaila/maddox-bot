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

`Database` wires up `organizations`, `repositories`, `agentTasks`, `pullRequests` (read-only), and
`receivedEvents`. `PullRequestRepository` was pulled forward from increment 13 because increment
7's GitHub event relevance check ("is this PR one the platform created?") needs it now; only
`findByRepositoryAndProviderNumber` exists — `create` and status updates are still increment 13's,
since real PR creation is the only thing that will ever populate this table until then.

The remaining entities' repository classes are added in the increment that actually needs them,
e.g. `JiraIssueRepository` (increment 13), `WorkspaceRepository` (increment 8), `ToolCallRepository`
/ `ApprovalRepository` (increments 11–12). Their tables already exist from increment 3's migration
so adding those classes later needs no further schema change.

## Local development

```bash
docker compose up -d               # from the repo root — starts Postgres on localhost:5433
pnpm --filter @maddox-bot/database db:migrate   # create/apply a migration after schema changes
```

Tests default `DATABASE_URL` to the compose instance (`postgresql://maddox:maddox@localhost:5433/maddox_bot`)
if it isn't already set — see `src/testDatabaseUrl.ts`.
