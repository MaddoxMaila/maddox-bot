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

## What's implemented vs. deferred

`Database` currently wires up `organizations`, `repositories`, and `agentTasks` — enough to prove
the pattern (schema, migrations, Prisma isolation, real integration tests) end to end. The
remaining entities' repository classes are added in the increment that actually needs them, e.g.
`JiraIssueRepository` (increment 6), `PullRequestRepository` / `WorkspaceRepository` (increment
13), `ToolCallRepository` / `ApprovalRepository` (increments 11–12). Their tables already exist
from this increment's migration so adding those classes later needs no further schema change.

## Local development

```bash
docker compose up -d               # from the repo root — starts Postgres on localhost:5433
pnpm --filter @maddox-bot/database db:migrate   # create/apply a migration after schema changes
```

Tests default `DATABASE_URL` to the compose instance (`postgresql://maddox:maddox@localhost:5433/maddox_bot`)
if it isn't already set — see `src/testDatabaseUrl.ts`.
