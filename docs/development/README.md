# Development setup

## Prerequisites

- Node `^20.19.0 || ^22.13.0 || >=24`
- [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`) — this repo pins
  `pnpm@10.33.0` via `packageManager`, so Corepack fetches and uses that version regardless of any
  globally installed pnpm.
- Docker (for Postgres/Redis via `docker-compose.yml`, and later the task sandbox)

## First-time setup

```bash
corepack enable
pnpm install
cp .env.example .env   # fill in values as later increments ask for them
docker compose up -d   # Postgres on localhost:5433, Redis on localhost:6380
docker build -t maddox-bot-sandbox:latest -f infrastructure/docker/sandbox.Dockerfile infrastructure/docker/
```

> This project's compose file intentionally does not use the default 5432/6379 ports, since this
> machine may already have other projects' Postgres/Redis containers running on those ports. Check
> `docker ps` if you're unsure what's already up before changing them.

The sandbox image build is a one-time step (not part of `pnpm install`) — `packages/sandbox`'s
tests fail with a clear error if it's missing. Rebuild after changing the Dockerfile.

## Common commands

```bash
pnpm build            # turbo run build, all packages
pnpm lint             # root eslint + turbo run lint
pnpm typecheck        # turbo run typecheck
pnpm test             # turbo run test
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .

turbo run build --filter=@maddox-bot/shared     # scope any task to one package
```

## Conventions

- Conventional Commits (`type(scope): subject`); branch names `<type>/<kebab-summary>` (no tool/runtime
  prefixes). See `docs/adr/` for architecturally significant decisions.
- TypeScript strict mode, no `any` in new code (lint-enforced).
- Tests are co-located with source (`foo.ts` + `foo.test.ts`) and ship in the same change as the code
  they cover; target ≥80% coverage on changed packages.

## Credentials needed by later increments

None are required to build/test increments 1–4. From increment 5 onward you'll need to provide, as
described in `.env.example`:

- A fine-grained GitHub PAT + a disposable test repository (increments 5, 13)
- A Jira Cloud site, email, and API token (increments 6, 13)
- An Anthropic API key (increment 9)
