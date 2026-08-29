# @maddox-bot/worker

The process that actually drives tasks forward: consumes the `agent-triggers` BullMQ queue (the
same queue `apps/api`'s webhook routes enqueue into), resolves a webhook event into a real
`AgentTask`, and runs `PlannerRunner`/`ImplementationAgentRunner` (`@maddox-bot/agent-core`)
against it with real GitHub/Jira/LLM/sandbox clients — the wiring every one of those packages'
own READMEs describe as "the worker's job."

## The pipeline

```
BullMQ job (AgentTriggerJobPayload)                    BullMQ job (TaskResumeJobPayload)
        │                                                       │
        ▼                                                       │
jobHandler.ts — resolve or create the AgentTask                 │
(idempotently — see below)                                      │
        │                                                       │
        ▼                                                       ▼
                    taskRunner.ts: recover if left mid-flight by a crash, then dispatch on state
        │
        ├─ CREATED              → plannerPhase.ts (clone + sandbox → PlannerRunner)
        ├─ PLANNED              → transition to AWAITING_APPROVAL, create a pending plan_approval
        └─ AWAITING_APPROVAL
              ├─ approved (or autoApprovePlans) → implementationPhase.ts (clone + sandbox → ImplementationAgentRunner)
              ├─ denied                          → transition to CANCELLED
              └─ still pending                    → stop; nothing more to do until a decision exists
```

Both queues funnel into the exact same `runTask()` — a fresh task, a crash-recovered one, and one
a human just approved via `apps/api`'s `POST /approvals/:id/decide` (which enqueues onto
`task-resume`, a separate queue from `agent-triggers`) all go through identical dispatch logic.
`startupRecovery.ts` runs this same dispatch for every task left in a non-terminal, non-paused
state when the worker process starts — a crash mid-task and a plain restart between two steps are
handled by the exact same code path too.

## Two different idempotency problems, two different fixes

This increment's own verification scenario is "kill mid-task, restart, assert idempotent resume
(no duplicate commit/PR)" — but building it surfaced **two** distinct places a duplicate could
come from, not one:

### 1. A worker process crash, mid-task

`taskRunner.ts`'s `recoverIfStuck()` is the fix. `ANALYZING` has no external side effects (the
Planner never writes anything outside Postgres), so it's always safe to reset to `CREATED` and
replan from scratch. The Implementation Agent's in-progress states
(`IMPLEMENTING`/`TESTING`/`FIXING`/`SELF_REVIEW`/`PR_CREATED`) are different: a crash there loses
the sandbox and the in-progress LLM conversation entirely (nothing about them is persisted beyond
the `tool_calls` audit trail — see agent-core's README on why that trail isn't a resumable
transcript). There is no partial state worth trying to resume, only one question worth asking:
**does a `pull_requests` row already exist for this task?**

- No → nothing external happened yet (or nothing that matters); reset to `AWAITING_APPROVAL` and
  restart the Implementation Agent from scratch.
- Yes → the task is substantively done; fast-forward straight to `AWAITING_HUMAN_REVIEW` instead
  of ever calling the Implementation Agent again. This is the one line standing between a crash
  recovery and a duplicate PR.

Both outcomes go through `TaskStateMachine.forceRecover()` (added this increment) rather than the
normal `canTransition()`-checked `transition()` — after a crash, the task's real-world side effects
are the actual source of truth, not whatever graph edge would normally apply from wherever it was
left.

### 2. BullMQ retrying the _job handler itself_

A **different** bug, found while building this: `agentTriggerQueue`'s jobs default to `attempts: 3`
with exponential backoff (`@maddox-bot/queue`). If `handleJiraTrigger` throws partway through —
say, a transient Jira API error — BullMQ retries the _entire handler function_, including the
`agentTasks.create()` call. Without a check, that retry creates a **second** `AgentTask` row for
the same webhook delivery, before the crash-recovery logic above ever gets involved. This has
nothing to do with the worker _process_ dying — it's an in-process retry of one job.

The fix is `AgentTaskRepository.findByReceivedEventId()`: `jobHandler.ts` checks for a task already
produced by this specific webhook event before creating one, and resumes that task instead of
making another. `trigger.receivedEventId` is a JSON field, not an indexed column — a real
uniqueness constraint would be a cleaner long-term fix, revisit if this lookup ever shows up in a
performance profile.

## Plan approval is real now; `autoApprovePlans` is a bypass, not the mechanism

Reaching `AWAITING_APPROVAL` always creates a real, pending `plan_approval` row (`ApprovalRepository`,
`@maddox-bot/database`) — that part isn't conditional on any flag. What _is_ conditional is whether
`runTask()` waits for a human to decide it via `apps/api`'s `POST /approvals/:id/decide`, or
proceeds immediately: `WorkerDependencies.autoApprovePlans` (on by default) skips waiting, useful
for exercising the Jira → implementation → PR pipeline without a human in the loop (e.g. local
development). A denied `plan_approval` transitions the task straight to `CANCELLED` — `runTask()`
checks the approval's actual `status` (not just "did something approve it"), so an explicit denial
and "still pending" are handled differently, not conflated into one "not approved yet" branch. Flip
`autoApprovePlans` off in a real deployment once a human is actually expected to review plans;
nothing else about the pipeline needs to change.

Tool-level approval isn't real yet, unlike plan approval: any tool that unexpectedly needs approval
mid-run gets `denyWithoutHuman()` — a safe-by-default deny, logged loudly, since there is no
`tool_approval` row ever created and no human to actually ask. Every tool wired into either role's
registry today is safe-tier, so this should never actually fire in practice.

## The live end-to-end test

`src/livePipeline.e2e.test.ts` is plan increment 17's own verification scenario — the same
Jira-trigger-to-opened-PR pipeline `workerPipeline.endToEnd.test.ts` proves with fakes, run instead
against a real GitHub repo, a real Jira Cloud issue, and a real (unscripted) Anthropic model. It's
part of this package's normal `pnpm test` run but skips cleanly, not as a failure, unless eight
specific environment variables are all set — see `tests/e2e`'s README for exactly what they are and
the one-time setup (a disposable repo, a real test issue) it needs.

## What's deliberately not here yet

- **GitHub-triggered jobs** (closing the loop on a platform-created PR — e.g. merged ->
  `COMPLETED`) are logged and skipped. The relevance check upstream already guarantees these only
  arrive for PRs this platform created, but reacting to _what kind_ of event needs the normalized
  payload's `merged` flag threaded through `AgentTriggerJobPayload`, which nothing produces yet.
  Smaller, separate follow-up work — not something this increment's crash-resume scenario needed.
- **Jira status transitions on PR open.** `ImplementationAgentInput.targetReviewStatus` exists and
  is fully wired in `@maddox-bot/agent-core` (and tested there), but nothing in this package sets
  it — there's no config surface yet mapping a repository to a workflow-specific "review" status
  name. `implementationPhase.ts` simply never passes it, so that transition never fires today.
- **Persisted `workspaces` rows.** Each task run gets a real clone + a real sandbox container
  (`workspace.ts`), but neither is recorded in the `workspaces` table — nothing reads workspace
  status yet (that's for whatever first needs to show it, e.g. a VS Code dashboard).
- **Pause signals reaching a running phase.** `TaskStateMachine` can represent `PAUSED`, but nothing
  external can request it mid-run yet — there's no API surface to send that signal from, and no
  point in the loop that checks for one. Cancellation is different and _is_ wired now: `apps/api`'s
  `POST /tasks/:id/cancel` (increment 16) transitions the row straight to `CANCELLED` itself,
  without needing this package's involvement — but a worker already mid-loop on that task still
  won't notice until whatever it's doing finishes or crashes, for the same reason pause can't
  interrupt one either.
