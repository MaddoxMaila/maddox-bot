# @maddox-bot/agent-core

The orchestration layer: `TaskStateMachine`, `ContextBuilder`, and `AgentLoopRunner` drive the
Planner and Implementation Agent roles over one shared tool-use loop (approved plan, section 6).
`PlannerRunner` (increment 12) wires `CREATED -> ANALYZING -> PLANNED`/`BLOCKED`.
`ImplementationAgentRunner` (increment 13) wires `AWAITING_APPROVAL -> IMPLEMENTING -> TESTING
<-> FIXING -> SELF_REVIEW -> PR_CREATED -> AWAITING_HUMAN_REVIEW` — both reuse the same
`AgentLoopRunner` with a different `AgentLoopOptions` value, not a separate code path.

## Design

### The loop is manual, not the Anthropic SDK's tool runner

`AgentLoopRunner` drives its own `while` loop over `LLMProvider.toolCall()` rather than using the
SDK's built-in tool runner, because every tool call must be persisted (`tool_calls`/`tool_results`)
as it happens — that's what lets a crashed worker resume a task from Postgres instead of losing an
in-progress role-run (spec §39). A role that only wraps someone else's opaque loop can't guarantee
that.

The tool-call bound (`maxToolCalls`, default 40) is checked **between** turns, not mid-turn: once a
turn's tool_use blocks start executing, all of them run before the bound is checked again. This can
overshoot the nominal bound by at most one turn's worth of calls, in exchange for never handing back
(or persisting, for a future resume) a transcript where an assistant turn has more tool_use blocks
than the following user turn has matching tool_results.

### Two-phase shape: explore with tools, then one structured call

A single Claude turn is either "call more tools" or "give a final answer" — Phase 1 doesn't mix
tool use and structured output in the same call. So the Planner's shape is: loop on
`llm.toolCall()` until a turn comes back with no `tool_use` blocks, then make exactly one
`llm.structuredOutput()` call (Zod schema `implementationPlanSchema`, via `messages.parse()`
under the hood) to get the final `ImplementationPlan`. The Implementation Agent's own tool-use
loops configure no `structuredOutput` at all — they just stop when the model stops calling tools;
its output is its side effects (files written, commits made), not a schema-shaped answer. (Its
_self-review_ step is a separate, single `structuredOutput()` call outside the tool-use loop
entirely — see below.)

### TaskStateMachine: the happy path is a graph, resuming isn't

`canTransition(from, to)` encodes the section-4 happy path plus four exceptional exits — `PAUSED`,
`CANCELLED`, `FAILED`, `BLOCKED` — reachable from any non-terminal state rather than repeated on
every row. Resuming _from_ `PAUSED`/`BLOCKED` is deliberately **not** a graph edge: the destination
is whatever `previousState` was recorded when the task entered that state, which is a per-row fact,
not a fixed transition. `resumeTarget()` validates that separately, and `TaskStateMachine.resume()`
persists through the same write path as a normal transition without going through `canTransition`.

`transition()` re-fetches the task's current state and compares it against the caller-supplied
`from` before writing anything. This is a single-writer assumption for Phase 1 (nothing else
concurrently drives a task's state yet) — the check exists to catch a coding mistake in the caller's
own sequencing, not to arbitrate concurrent writers. Revisit if/when the API's pause/cancel
endpoints (increment 15+) can race a running worker.

`PlannerRunner` stops at `PLANNED` on success. The `PLANNED -> AWAITING_APPROVAL` transition, and
creating the `plan_approval` `Approval` row it implies, belongs to whatever orchestration loop
reacts to a completed Planner run (the worker, increment 14) — not to the role-run itself. On
failure to produce a plan (timeout or exhausted tool-call budget), `PlannerRunner` transitions to
`BLOCKED` instead and records a `planning_failed` task event, rather than silently leaving the task
in `ANALYZING` or claiming a nonexistent plan.

### ImplementationAgentRunner: only _writing code_ and _fixing failures_ are LLM-driven

Everything else in the Implementation Agent's flow — running the verification suite, pushing,
opening the PR with a well-defined template, linking Jira — is deterministic code in
`ImplementationAgentRunner`, not something left to the model's judgement to remember to do
correctly. Concretely:

- **IMPLEMENTING**: one `AgentLoopRunner.run()` call, full read/write toolset, no `structuredOutput`
  — the model writes code, adds tests, and commits until it stops calling tools.
- **TESTING**: _not_ an LLM call at all. `runVerificationGate()` calls
  `shell.run_build/lint/typecheck/tests` directly (through the same `executeAndRecordTool` path an
  LLM tool call would use, so the audit trail doesn't distinguish who decided to make the call) and
  collects every failure, not just the first.
- **FIXING**: if the gate failed, another bounded `AgentLoopRunner.run()` call, continuing the
  _same_ conversation (the accumulated `messages` from the prior attempt, not a fresh transcript)
  with the failure output appended as a user message — the model needs to remember what it already
  wrote to fix it intelligently. Up to `maxFixAttempts` (default 3, per section 6) before giving up.
- **SELF_REVIEW**: a lightweight, non-blocking pass — one `structuredOutput()` call (`selfReviewSchema`)
  over the final `git.diff`, _outside_ the tool-use loop entirely. Phase 1 doesn't act on what it
  finds beyond recording it in the PR body; this is not spec §35's full independent-context
  adversarial review.
- **PR_CREATED**: push, then `github.create_pr` with a title/body built by `pullRequestTemplate.ts`
  (shaped after Infinite-Forge's own PR template — Overview / Files Changed / Testing / Checklist —
  applied to what an autonomously-generated PR actually has to report), then `pullRequests.create()`
  persists the structured row.
- **Jira linking is best-effort, deliberately not fatal.** `jira.link_pr` and (if
  `targetReviewStatus` is given) `jira.update_issue` run after the PR already exists; either one
  failing is recorded as a `jira_link_failed`/`jira_transition_failed` task event but does **not**
  block the result — the PR is the primary deliverable, and it already succeeded. `targetReviewStatus`
  is optional and caller-supplied rather than hardcoded, since transition names are workflow-specific
  (e.g. "In Review" vs. "Code Review") and this package has no business assuming one.

Every failure path (branch creation, an incomplete implementation/fix loop, push, PR creation, or
exhausting the fix-retry budget) records a task event describing _why_, then transitions to
`BLOCKED` — never left dangling in an active state, and never silently swallowed.

### What's in `task_events` vs. `tool_calls`

`task_events` stays coarse-grained (state transitions, `plan_produced`/`planning_failed`,
`pull_request_created`, `jira_link_failed`, ...) — it's the VS Code timeline's data source. The
fine-grained per-call record (every tool invocation, its permission tier, its result) lives in
`tool_calls`/`tool_results` instead, written by the shared `executeAndRecordTool()` helper
(`toolExecution.ts`) that both `AgentLoopRunner` (an LLM-driven call) and `ImplementationAgentRunner`
(a programmatic one, e.g. the verification gate) go through. Duplicating every tool call into
`task_events` too would just be timeline noise.

### Increment 11 gap fixed here: `ToolResult` didn't expose its permission tier

Persisting `tool_calls.permission_decision` needs to know what tier `PermissionGate` actually
classified a call at. Re-classifying independently inside `agent-core` (a second `PermissionGate`
instance, just for logging) would risk disagreeing with the tier `ToolRegistry` actually enforced if
the two were ever configured differently. Fixed at the source instead: `ToolResult` now carries an
optional `permission: { tier, reason }`, populated by `ToolRegistry.execute()` itself once
classification happens (absent only for `unknown_tool`/`invalid_input`, which never reach
classification) — one source of truth for what gated a call.

### `Database.forUrl(url)`

Only `@maddox-bot/database` may import `@prisma/client` — this package's own tests need to seed
fixture rows against `testDatabaseUrl()` without violating that boundary, and without a bare
`new Database()` silently depending on ambient `process.env.DATABASE_URL`. `Database.forUrl()`
builds a fully-wired `Database` for an explicit connection string while keeping `PrismaClient`
construction private to the package that owns it.

### Converting tool schemas: `z.toJSONSchema`, not `zod-to-json-schema`

`agent-tools`' `ToolDefinition.inputSchema` is a live Zod schema (for runtime validation);
`@maddox-bot/llm`'s `ToolDefinition.inputSchema` is a plain JSON Schema object (what actually goes
on the wire to Claude). Zod v4 ships JSON Schema conversion built in (`z.toJSONSchema`) — no need
for the third-party `zod-to-json-schema` package anymore. It always injects a top-level `$schema`
key that Anthropic's `input_schema` has no use for, so `toLLMToolDefinitions` strips it.

## What's deliberately not here yet

- **Which tools a role gets, wired from real clients with live config** (a real GitHub PAT, a real
  Jira site, a real Docker sandbox) is the worker's job (increment 14), not this package's — it
  only ever receives an already-populated `ToolRegistry`. `@maddox-bot/git`/`github`/`jira` appear
  here only as **devDependencies**, for the end-to-end tests' own fixture setup (a real local git
  repo with a real bare remote; a real `GitHubClient`/`JiraClient` wrapping a fake wire client) —
  agent-core's actual source never imports them. `ContextBuilder`'s functions take pre-fetched
  Jira/repo/plan data for the matching reason: fetching it is I/O the caller does first, which
  keeps context assembly synchronous and trivially testable.
- **Approval rows.** `AgentLoopOptions.requestApproval` is a plain injected callback; nothing here
  creates an `Approval` row, since every tool wired into the end-to-end tests is safe-tier and
  never reaches it in practice. That machinery arrives with whatever actually needs it — most
  likely the API's approval endpoints, once a human is the one deciding.
- **Pause/cancel while a loop is running.** `TaskStateMachine` can represent `PAUSED` and resume
  from it, but nothing yet calls it mid-run — there's no cancellation signal wired into
  `AgentLoopRunner`'s loop. That's worker territory (increment 14).
- **Branch-name templating.** `ImplementationAgentInput.branchName` is a plain pre-computed string,
  the same convention as everything else this package takes pre-fetched — interpolating
  `repositories.branch_naming_template` is the caller's job.
- **Large-deletion approval enforcement.** The plan's own permission table calls out "heuristically
  large deletions" as approval-required, but `@maddox-bot/permissions`' `PermissionGate.classifyCommit`
  can only classify it if a `linesDeleted` count is actually supplied — and nothing computes and
  passes one yet (the registry stays git-agnostic by design, so it can't compute a diff itself; the
  alternative, a `git.commit` tool that self-gates via `ctx.requestApproval` after computing its own
  diff, is real but not built). `git.commit` is safe-tier unconditionally for now — a known,
  documented Phase 1 gap, not a silently dropped requirement.
