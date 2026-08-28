# @maddox-bot/permissions

`PermissionGate.classify({ toolName, input })` → `{ tier, reason }`, where `tier` is `safe`,
`approval_required`, or `human_only`. This is where spec §20's three-tier table becomes enforced
behavior — the platform's actual security boundary, per ADR-0001.

## Calibration

Gate the unusual, not the routine actions of an already-authorized task — gating everything would
defeat "keeps working while the laptop is offline" (spec §20's own framing). Concretely:

- **Safe**: every read tool, plus the expected write actions of a task that's already running —
  committing to its own branch, opening the PR, narrating progress in Jira. One exception: pushing
  to a protected branch (`main`/`master` by default, configurable) is `human_only` — a defense-in-depth
  addition beyond the plan's literal table, since no Phase-1 tool should ever need to do this.
- **Approval required**: `shell.run` (always — it's the escape hatch beyond the named tools, and
  least privilege says an escape hatch should itself be gated, regardless of what command it
  carries; the `dependency_install` vs `unrecognized_shell_command` reason is for the approval UI,
  not a safe/unsafe split), a sensitive `repo.write_file` path (`.github/workflows/**`, `infra/**`,
  migrations), `git push --force`, and a `git.commit` whose caller-supplied `linesDeleted` exceeds
  the configurable threshold (this package doesn't compute diffs itself — see `PermissionCheckInput`).
- **Fails closed**: an unrecognized tool name, or malformed input on a tool this package does
  inspect (e.g. `repo.write_file` with no `path`), is `approval_required` — never silently allowed
  just because the classifier didn't recognize the shape.

`github.submit_review` is deliberately `approval_required` even though the plan's own tier table
didn't list it: submitting a review under a delegated identity is exactly the impersonation-adjacent
action spec §15 is cautious about, and Phase 2 hasn't designed the real review-delegation policy
yet — a conservative default now beats an unreviewed decision made by omission later.
