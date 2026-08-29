# @maddox-bot/agent-tools

`ToolRegistry` wires `git`/`repo`/`github`/`jira`/`shell` tools (spec §10) behind
`@maddox-bot/permissions`' `PermissionGate` — the platform's actual security boundary. Read tools
since increment 11; write tools (`repo.write_file`, `git.commit`/`push`/`create_branch`/`checkout`,
`github.create_pr`/`comment`, `jira.add_comment`/`update_issue`/`link_pr`) since increment 13,
alongside the Implementation Agent that needs them.

Every `create*Tools()` factory comes in a read and a write flavor
(`createRepoReadTools`/`createRepoWriteTools`, `createGitReadTools`/`createGitWriteTools`, ...) kept
as **separate functions**, not one function returning everything — a role like the Planner is meant
to be registered with read tools only, and a single combined factory would make that a runtime
convention to remember rather than a type-level fact about which function you called.

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
result. `permission: { tier, reason }` (added in increment 13) reports whatever tier the call was
actually classified at — absent only for `unknown_tool`/`invalid_input`, which never reach
classification. This exists so a caller building an audit trail (agent-core, into `tool_calls`)
has one source of truth for what gated a call, instead of re-classifying independently and risking
disagreement with what the registry actually enforced.

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
- `repo.read_file`/`repo.write_file`/`repo.list_files` all resolve their caller-supplied path
  through the same traversal guard (`repoFileWalker.ts`'s `resolveWithinRepo`) before touching the
  filesystem — a hallucinated or adversarial `path: "../../etc/passwd"` can only ever resolve
  inside the repository root, never outside it.
- `repo.write_file` accepts an optional `expectedSha` (from a prior `repo.read_file`): if the
  file's current content no longer matches it, the write is rejected as `stale_write` rather than
  silently clobbering a change the agent doesn't know about.
- `shell.run_tests/lint/typecheck/build` detect a project's own script via `package.json` +
  lockfile-based package-manager detection (Node/TS only — spec §36's multi-language detection is
  later work), then run it **inside the sandbox** via `Sandbox.exec`. A non-zero exit is a normal
  `ok: true` outcome carrying `exitCode`/`stdout`/`stderr` — a failing test is meaningful data for
  the Implementation Agent to react to, not a tool malfunction. A repo with no such script
  configured returns `{skipped: true, reason: ...}` — a valid state, not an error.
- `shell.run` itself (the generic escape hatch) isn't wired here at all — per
  `@maddox-bot/permissions`, it's always `approval_required` regardless of command, and nothing
  yet builds the (job-specific, presumably) shell commands it would need to run.

## `git.*` and `github.*`: no separate "create a branch on GitHub" tool

Creating a branch is a git-protocol operation — pushing a new ref _is_ how it comes to exist on
GitHub. `git.create_branch` (local) + `git.push` cover the whole thing, so there's no
`github.create_branch` REST wrapper to gate or maintain; `@maddox-bot/permissions`' `SAFE_TOOLS`
set doesn't list one.
