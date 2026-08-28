# @maddox-bot/agent-core

The orchestration layer: `TaskStateMachine`, `ContextBuilder`, and `AgentLoopRunner` drive the
Planner and Implementation Agent roles over one shared tool-use loop (approved plan, section 6).
**Planner only for increment 12** — `PlannerRunner` wires the pieces together end-to-end
(`CREATED -> ANALYZING -> PLANNED`/`BLOCKED`); the Implementation Agent (`AWAITING_APPROVAL ->
... -> PR_CREATED`) is increment 13's job, reusing `AgentLoopRunner` with a different
`AgentLoopOptions` value rather than a separate code path.

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
under the hood) to get the final `ImplementationPlan`. A role with no `structuredOutput` configured
(the Implementation Agent, later) just stops when the model stops calling tools — its output is its
side effects, not a schema-shaped answer.

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

### What's in `task_events` vs. `tool_calls`

`task_events` stays coarse-grained (state transitions, `plan_produced`/`planning_failed`) — it's the
VS Code timeline's data source. The fine-grained per-call record (every tool invocation, its
permission tier, its result) lives in `tool_calls`/`tool_results` instead, written directly by
`AgentLoopRunner`. Duplicating every tool call into `task_events` too would just be timeline noise.

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

- **Which tools a role gets, wired from real clients** (GitHub/Jira/git/sandbox with live config)
  is the worker's job (increment 14), not this package's. The end-to-end test constructs its own
  `ToolRegistry` directly from a fixture repo for exactly this reason.
  `ContextBuilder`/`buildPlannerContext` takes pre-fetched Jira/repo data for the same reason —
  fetching it is I/O the caller does first, which keeps context assembly synchronous and trivially
  testable.
- **Approval rows.** `AgentLoopOptions.requestApproval` is a plain injected callback; nothing here
  creates an `Approval` row yet, since the Planner's tools are all safe-tier and never reach it in
  practice. That machinery arrives with whatever actually needs it (the Implementation Agent's
  approval-required tools, or the API's approval endpoints).
- **Pause/cancel while a loop is running.** `TaskStateMachine` can represent `PAUSED` and resume
  from it, but nothing yet calls it mid-run — there's no cancellation signal wired into
  `AgentLoopRunner`'s loop. That's worker territory (increment 14).
