# tests/fixtures

## `sample-repo/`

A minimal, dependency-free Node package used by `packages/sandbox`'s end-to-end test: real files
committed here, turned into an actual local git repository at test-run time (git-init + commit into
a temp directory — there's no nested `.git` committed in this monorepo), then cloned via
`@maddox-bot/git` and run inside a real sandbox container (`pnpm install && pnpm test`). It uses
Node's built-in test runner (`node --test`) specifically so the install step has nothing to fetch —
deterministic and fast, not dependent on registry access.

This repo represents an independent external target, not code governed by this repo's own
standards — excluded from this repo's ESLint/Prettier config on purpose.

## Webhook payload fixtures

Used inline in `apps/api`'s webhook route tests (increment 7) rather than as separate files here —
see `apps/api/src/buildApp.test.ts`.
