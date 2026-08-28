# infrastructure/docker

The root `docker-compose.yml` (Postgres + Redis) is defined at the repo root, not here, so
`docker compose up` works from the repo root without a `-f` flag.

This directory holds the **sandbox base image** — the image the worker uses to spin up an isolated
container per task (clone, install, run commands, destroy). It arrives in increment 8
(`packages/sandbox`) along with the container lifecycle code that builds and runs it; nothing here
yet.
