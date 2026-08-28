# @maddox-bot/agent-tools

`ToolRegistry` wires `git`/`repo`/`github`/`jira`/`shell` tools (spec §10) behind
`@maddox-bot/permissions`' `PermissionGate` — the platform's actual security boundary. **Read-only
for increment 11**: write tools (`git.commit`, `git.push`, `github.create_pr`, `jira.update_issue`,
etc.) are added in increment 13 alongside the Implementation Agent that needs them.

## Design

`ToolRegistry.execute(name, rawInput, ctx)` is the only path a tool call takes:

```
validate against the tool's own Zod schema
        ↓
PermissionGate.classify({ toolName, input })
        ↓
   safe → run it            approval_required → ctx.requestApproval()   human_only → never run
        ↓                           ↓ approved / denied                          ↓
   tool.execute(input, ctx)    run it / return denied                    return human_only error
```

`durationMs` is measured once, by the registry, wrapping the whole call — not duplicated inside
each tool — so it's directly comparable across every tool regardless of which path produced the
result.

### A TypeScript gotcha worth knowing about

`ToolDefinition<TInput, TOutput>` declares `execute` as a **method signature**
(`execute(input: TInput, ctx): Promise<...>`), not a function-typed property
(`execute: (input: TInput, ctx) => Promise<...>`). This isn't stylistic — TypeScript checks method
signatures bivariantly but function-typed properties contravariantly. Since `createGitReadTools()`
etc. return `ToolDefinition[]` (i.e. `ToolDefinition<unknown, unknown>[]`) built from tools whose
real input types are much narrower (`{owner: string; repo: string}`, ...), only the bivariant
method form allows that — the function-property form rejects every tool as structurally unsound
before you even get to a registry. See `toolDefinition.ts` for the full comment.

## `repo.*` and `shell.*`: what's real vs. heuristic

- `repo.find_references` / `repo.find_definition` are **whole-word text search**, not a language
  server — good enough for a Planner to locate likely-relevant files, not semantic analysis.
- `shell.run_tests/lint/typecheck/build` detect a project's own script via `package.json` +
  lockfile-based package-manager detection (Node/TS only — spec §36's multi-language detection is
  later work), then run it **inside the sandbox** via `Sandbox.exec`. A non-zero exit is a normal
  `ok: true` outcome carrying `exitCode`/`stdout`/`stderr` — a failing test is meaningful data for
  the Implementation Agent to react to, not a tool malfunction. A repo with no such script
  configured returns `{skipped: true, reason: ...}` — a valid state, not an error.
- `shell.run` itself (the generic escape hatch) isn't wired here at all — per
  `@maddox-bot/permissions`, it's always `approval_required` regardless of command, so it's write-path,
  increment-13 territory alongside the other gated actions.
