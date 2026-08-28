# The image every task sandbox container runs. Deliberately minimal: git (host clones/pushes
# happen outside the container, but the repo's own tooling may still shell out to git — e.g. husky
# hooks, changesets), Node + Corepack (pnpm/yarn/npm via corepack, matching whatever the target
# repo's packageManager field specifies), and nothing else. No cloud CLIs, no build toolchains
# beyond what npm/pnpm need — anything a specific repo additionally needs is that repo's own
# devDependency or a documented follow-up to this image, not a default baked in here.
FROM node:22-alpine

RUN apk add --no-cache git

RUN corepack enable

WORKDIR /workspace
