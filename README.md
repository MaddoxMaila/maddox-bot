# maddox-bot

An AI Software Engineering Agent Platform: an event-driven system that monitors Jira and GitHub,
implements Jira tickets autonomously (branch → code → tests → self-review → PR), reviews pull
requests, and is controlled from a VS Code extension whose backend keeps working while your laptop
is offline. Not a chatbot — persistent task state, explicit tools, permissions, sandboxed execution,
and human approval gates.

Currently building **Phase 1**: backend, PostgreSQL, queue, GitHub integration, Jira integration, a
basic agent runtime (Planner + Implementation Agent), a repository sandbox, basic VS Code chat, and
the Jira → implementation → PR workflow end-to-end. See [`docs/adr/0001-phase-1-stack.md`](docs/adr/0001-phase-1-stack.md)
for the stack decisions and rationale, and [`docs/development/README.md`](docs/development/README.md)
for setup.

## Repository map

```
apps/
  api/                 Fastify REST + WebSocket gateway, webhook receivers
  worker/              BullMQ consumer running agent-core
  vscode-extension/    Chat + task dashboard, WebSocket client
packages/
  agent-core/          Task state machine, context builder, agent loop (Planner + Implementation Agent)
  agent-tools/         Tool registry: git/repo/github/jira/shell tools
  permissions/         Permission tiers + approval gate
  github/              GitHub client (PAT auth) + webhook verification
  jira/                Jira Cloud client + webhook verification
  git/                 Thin wrapper over simple-git for sandbox working trees
  sandbox/             Docker sandbox lifecycle (create/exec/destroy)
  database/            Prisma schema, migrations, repository classes
  queue/               JobQueue interface + BullMQ adapter
  events/              Normalized event envelope, dedupe, relevance rules
  llm/                 LLMProvider abstraction + Anthropic implementation
  shared/              Cross-cutting types, IDs, result helpers, logger
  playwright/          Reserved — Phase 2
infrastructure/
  docker/              Compose services + sandbox base image
docs/
  adr/                 Architecture decision records
  architecture/        System design notes
  security/            Threat model and security notes
  development/         Setup and local development guide
tests/
  integration/  e2e/  fixtures/
```

## Status

Phase 1, increment 1 (monorepo scaffold) in progress. See the approved plan for the full build
sequence.
