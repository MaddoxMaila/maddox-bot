# @maddox-bot/sandbox

Docker container lifecycle for running a task's **untrusted** commands (installs, builds, tests) —
the actual attack surface per spec §21/§22. `Sandbox.create()` bind-mounts an _existing_ host
directory (typically a `@maddox-bot/git` clone — this package doesn't clone anything itself, see
that package's README for why), starts a locked-down container, and `exec()` runs commands inside
it with a timeout. `destroy()` removes the container.

## Security posture (every container)

- No Docker socket, no `--privileged`.
- `ReadonlyRootfs: true` — a `tmpfs` at `/tmp` and `/root` covers the writable scratch space tools
  actually need (pnpm/corepack write caches under `$HOME` unprompted, not just to `/tmp` — without
  this the very first `pnpm install` fails outright, not just warns).
- `CapDrop: ["ALL"]`, `SecurityOpt: ["no-new-privileges"]`.
- `PidsLimit` (default 256), optional `NanoCpus`/`Memory` caps.
- Every container carries the `com.maddox-bot.sandbox` label for identification.

**Known gap, not solved here** (see ADR-0001 and `docs/security/README.md`): no network egress
allowlisting yet — containers can reach the public internet (needed for `pnpm install` against the
real registry), which is broader than ideal. Flagged for Phase 2 hardening.

## What this package deliberately does not do

No image build/pull-if-missing logic. `Sandbox.create()` checks the image exists locally and throws
a clear, actionable error if not — build it once via `infrastructure/docker/sandbox.Dockerfile` (see
that directory's README). Auto-building on every sandbox creation is exactly the kind of extra
machinery a one-time local dev setup step doesn't need.

## Local development

Requires Docker and the sandbox image built (`infrastructure/docker/README.md`). The end-to-end
test (`sandbox.endToEnd.test.ts`) exercises the full plan-increment-8 scenario against
`tests/fixtures/sample-repo`: real clone, real container, `pnpm install && pnpm test`, real destroy,
and confirms the container is actually gone afterward.
