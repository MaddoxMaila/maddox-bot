# @maddox-bot/shared

Cross-cutting types and helpers with no dependency on any other package in this monorepo, so every
package (database, api, worker, agent-core, the VS Code extension) can depend on it without creating
cycles.

- **`id.ts`** — `createId()` (UUID v4) and the `Branded<T, Brand>` utility for nominal-typed IDs
  (e.g. a future `TaskId`/`SessionId` defined where those entities live).
- **`result.ts`** — a `Result<T, E>` discriminated union (`ok`/`err`/`isOk`/`isErr`) for operations
  that want to return failure explicitly rather than throw.
- **`taskState.ts`** — the Phase 1 task-state vocabulary (`TaskState`, `TASK_STATES`, `isTaskState`)
  shared by every package that persists, transitions, or renders a task's state. The transition
  rules themselves live in `packages/agent-core`, not here.
- **`logger.ts`** — `createLogger(name)`, a thin wrapper over [pino](https://getpino.io) with
  secret-shaped fields (`token`, `secret`, `apiKey`, `password`, ...) redacted by default, one level
  of nesting deep.
