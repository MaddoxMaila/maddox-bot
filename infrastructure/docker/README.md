# infrastructure/docker

The root `docker-compose.yml` (Postgres + Redis) is defined at the repo root, not here, so
`docker compose up` works from the repo root without a `-f` flag.

## `sandbox.Dockerfile`

The image every task sandbox container runs (`packages/sandbox`): Node 22 (Alpine) + git +
Corepack. Deliberately minimal — no cloud CLIs, no build toolchains beyond what npm/pnpm need.

Build it once (not part of `pnpm install` — see `packages/sandbox`'s README for why there's no
auto-build-on-demand logic):

```bash
docker build -t maddox-bot-sandbox:latest -f infrastructure/docker/sandbox.Dockerfile infrastructure/docker/
```

Rebuild after changing the Dockerfile; `packages/sandbox`'s tests will fail with a clear
"image not found locally" error if this hasn't been run yet.
