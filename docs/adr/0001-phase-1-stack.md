# ADR-0001: Phase 1 foundational stack

- **Status:** Accepted
- **Date:** 2026-08-28
- **Deciders:** Project owner (Maddox), Claude Code (architect role)

## Context

Phase 1 of the AI Software Engineering Agent Platform (see the approved plan) needs a backend,
database, queue, sandboxed execution model, GitHub/Jira integration, and an LLM abstraction, before
any agent behavior can be built. The spec mandates a strongly-typed backend and an `LLMProvider`
abstraction, but otherwise leaves language/framework/sandbox-technology choices open. This ADR
bundles the foundational choices made together as one Phase-1 stack, since they were evaluated as a
package and several depend on each other (e.g. one language across the monorepo removes the need to
hand-sync types between a Python backend and the TypeScript VS Code extension).

Local environment constraints discovered while scoping this: the globally installed `pnpm@11.16.0`
will not run on this machine's Node `20.20.2` (`ERR_UNKNOWN_BUILTIN_MODULE`, requires Node ≥22.13);
and Docker is already running this machine's other project containers on the default Postgres
(5432) and Redis (6379) ports.

## Decision

We will build Phase 1 as a TypeScript pnpm/Turborepo monorepo: Fastify for the API, Prisma for the
database layer, Redis+BullMQ behind a `JobQueue` interface, Docker sibling containers (worker holds
the socket, task containers do not) for sandboxed execution, a fine-grained GitHub Personal Access
Token for GitHub auth, Jira Cloud REST v3 for Jira, and an `LLMProvider` interface defaulting to
Anthropic's Claude via `@anthropic-ai/sdk`. We pin `packageManager: pnpm@10.33.0` via Corepack so the
project uses a Node-20-compatible pnpm regardless of what's installed globally, and we run this
project's `docker-compose.yml` on host ports 5433 (Postgres) and 6380 (Redis) to avoid colliding with
this machine's existing containers from unrelated work.

The deployment target — now and for the foreseeable roadmap, not just Phase 1 — is a **single
conventional VM running `docker-compose`**, not Kubernetes or Terraform-managed cloud infrastructure.
Spec §42's load-balancer/horizontal-scaling architecture is accordingly out of scope; there is no
`infrastructure/kubernetes/` or `infrastructure/terraform/` in this repository. `infrastructure/docker/`
(compose services + the sandbox base image) is the entire deployment surface.

## Alternatives considered

| Option                                                      | Pros                                                                                                      | Cons                                                                                                                             | Why not chosen                                                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python backend (FastAPI) + TS extension                     | Rich LLM/agent-framework ecosystem (LangGraph, etc.)                                                      | Two type systems to hand-sync across every shared contract (event envelope, tool schemas, task-state enum, WS message union)     | The cross-cutting-contract cost outweighs ecosystem convenience for a system whose center of gravity is the shared state machine, not model orchestration tricks |
| NestJS for the API                                          | Batteries-included DI, module system, mature ecosystem                                                    | Real value at team/enterprise scale; for one developer building Phase 1 it's ceremony without payoff                             | Plain constructor-injected classes in a composition root give equivalent testability with less machinery                                                         |
| Firecracker / gVisor for sandboxing                         | Stronger isolation than containers                                                                        | Linux-only, needs bare-metal or nested virtualization; this is a macOS dev machine on Docker Desktop                             | Wrong tool for Phase 1's local/self-hosted target; revisit once this is genuinely multi-tenant/cloud-hosted                                                      |
| Docker-in-Docker for sandboxing                             | Simpler mental model (nested Docker)                                                                      | Needs privileged mode and has storage-driver footguns                                                                            | Socket-mounted sibling containers give the same isolation without privileged mode                                                                                |
| Bare subprocess in a tmpdir                                 | Zero infra, fastest to build                                                                              | Runs untrusted repository code directly on the host — spec §21 forbids this outright                                             | Rejected; not a legitimate Phase-1 shortcut given real `npm install`/test/build execution from ticket-target repos                                               |
| GitHub App instead of PAT                                   | Matches spec's "service account, least privilege" framing more closely; declarative webhook subscriptions | Requires registering an app manifest, a private key, and an installation-token exchange before anything else can be built        | User chose PAT for Phase 1 to bootstrap solo faster; isolated to `packages/github`'s auth strategy so it's a later swap, not a rewrite                           |
| Anthropic SDK's Tool Runner (beta) instead of a manual loop | Less code to write; owns its own loop                                                                     | Owns the loop in-process — can't persist state after each tool call or resume a crashed worker mid-loop from Postgres (spec §39) | A loop we drive ourselves is required for crash-recovery, which is a hard Phase-1 requirement                                                                    |

## Consequences

- Every shared contract (event envelope, task-state enum, tool schemas, WebSocket message union) lives
  in one TypeScript type, imported by the API, worker, agent-core, and the VS Code extension — no
  cross-language sync burden.
- The worker process becomes a genuine trust boundary because it holds the Docker socket: it must
  never execute repository-supplied code itself, only spawn sandbox containers. This is enforced by
  convention now and should get an explicit check (e.g. a lint rule or code-review checklist item)
  before Phase 2 hardening.
- Network egress from sandbox containers is not yet allowlisted — a known, stated gap (see the plan's
  risk list), not an oversight, to be addressed as Phase 2+ hardening.
- Swapping GitHub PAT → GitHub App later touches only `packages/github`'s auth strategy, not callers.
- `docker-compose.yml` here must keep using 5433/6380 (or update this ADR and the `.env.example`
  together) as long as this machine also runs the other project's containers on 5432/6379.
- Horizontal scaling and multi-node scheduling are not goals of this architecture. If load ever
  requires more than one VM, that's a future ADR, not an assumption baked in today.

## References

- Approved plan: `~/.claude/plans/lazy-gathering-spark.md` (sections 1, 7, 8)
- Spec §§ 21 (sandboxing), 23 (credentials), 29 (LLM abstraction), 39 (recovery)
