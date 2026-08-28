# @maddox-bot/git

A thin wrapper over [simple-git](https://github.com/steveukx/git-js) for the host-side working
tree behind a task's sandbox: `clone`, `status`, `diff`, `log`, `branch`, `createBranch`,
`checkout`, `commit`, `push`.

## Why cloning happens on the host, not inside the sandbox container

`packages/sandbox` isolates **untrusted repository code execution** (installs, builds, tests) —
that's the actual attack surface (spec §21/§22). Git operations themselves don't execute anything
from the repository; they read/write git objects using a trusted binary. So the worker clones and
commits directly via this package on a host temp directory, and that same directory is
bind-mounted into the task's sandbox container for the untrusted part. Neither package needs to
know about the other: `GitClient` just operates on a local path, and `packages/sandbox` just runs
commands inside a container pointed at whatever path it's given.

## Credentials

`buildAuthenticatedCloneUrl` injects a fine-grained PAT into an `https://` clone URL
(`x-access-token:<token>@`) so cloning a private repo doesn't need a configured credential helper.
Since cloning is host-side, the token is never available inside a sandbox container.

## Identity

A fresh clone has no local git identity configured — `CloneOptions.identity` (or
`GitClient.setIdentity`) sets `user.name`/`user.email` on that clone before the caller commits.
