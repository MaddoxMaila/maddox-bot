# @maddox-bot/worker

The process that actually drives tasks forward: consumes the `agent-triggers` BullMQ queue (the
same queue `apps/api`'s webhook routes enqueue into), resolves a webhook event into a real
`AgentTask`, and runs `PlannerRunner`/`ImplementationAgentRunner` (`@maddox-bot/agent-core`)
against it with real GitHub/Jira/LLM/sandbox clients — the wiring every one of those packages'
own READMEs describe as "the worker's job."

## The pipeline

```
BullMQ job (AgentTriggerJobPayload)
        │
        ▼
jobHandler.ts — resolve or create the AgentTask for this event (idempotently — see below)
        │
        ▼
taskRunner.ts — recover if the task was left mid-flight by a crash, then dispatch on its state
        │
        ├─ CREATED              → plannerPhase.ts   (clone + sandbox → PlannerRunner)
        ├─ PLANNED (auto-approve) → transition to AWAITING_APPROVAL
        └─ AWAITING_APPROVAL (auto-approve) → implementationPhase.ts (clone + sandbox → ImplementationAgentRunner)
```

`startupRecovery.ts` runs this same dispatch for every task left in a non-terminal, non-paused
state when the worker process starts — a crash mid-task and a plain restart between two steps are
handled by the exact same code path.

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

## Auto-approving plans (a stopgap, not a design decision)

There's no plan-approval UI yet — the API's approval endpoints are increment 15, and there's no
VS Code extension yet either. `WorkerDependencies.autoApprovePlans` (on by default) has the worker
approve every plan itself immediately after `PlannerRunner` produces one, purely so the
Jira → implementation → PR pipeline can be exercised end-to-end today. The state machine still
records a real `AWAITING_APPROVAL -> IMPLEMENTING` transition (with `autoApproved: true` in the
event payload) — only the _decision_ is automated, not the bookkeeping. Flip the flag off once a
real approval endpoint exists; nothing else about the pipeline needs to change.

For the same reason, any tool that unexpectedly needs approval mid-run gets `denyWithoutHuman()`
— a safe-by-default deny, logged loudly, since there is no human to actually ask yet. Every tool
wired into either role's registry today is safe-tier, so this should never actually fire in
practice.

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
- **Pause/cancel signals reaching a running phase.** `TaskStateMachine` can represent `PAUSED`, but
  nothing external can request it mid-run yet — there's no API surface to send that signal from.
