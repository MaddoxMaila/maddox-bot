# @maddox-bot/vscode-extension

The VS Code control surface (increment 16, plan section 8): a single webview panel combining a
task dashboard (task list, live event log for whichever task is selected, pending plan approvals
with Approve/Deny buttons) and a chat box understanding a small fixed command set — "basic VS Code
chat," per the plan, not open-ended conversational reference resolution. Talks to `apps/api` over
plain REST + the `/tasks/:id/stream` WebSocket gateway; never touches Postgres, Redis, GitHub,
Jira, or the LLM directly.

## Chat commands

`implement <ISSUE-KEY>`, `status`, `diff`, `cancel`, `help`. `pause`/`resume` (`continue`) parse
but reply "not supported yet" — see "What's deliberately not here yet" below.

## Architecture: what's unit tested vs. what's verified manually

Split deliberately so nearly everything is plain, DOM/`vscode`-free TypeScript:

- **Unit tested** (`src/*.test.ts`, run via `pnpm test`): `commandParser.ts` (pure), `protocol.ts`
  (the host↔webview message contract plus a type guard), `apiClient.ts` (a real local HTTP server
  stands in for `apps/api` — no `fetch` mocking), `taskSocket.ts` (a real local `ws` server stands
  in for the stream gateway), `chatViewModel.ts` and `dashboardViewModel.ts` (pure reducers/command
  handlers, taking a `MaddoxApiClient` — this repo's established narrow-client-interface pattern,
  see `@maddox-bot/github`'s `OctokitLike` — so they run against a fake with no real network calls),
  `webview/getHtml.ts` (pure string templating).
- **Glue, excluded from coverage, verified manually** (`vitest.config.ts`'s exclude list):
  `extension.ts` (the only file touching the real `vscode` module — activation, the webview
  panel's lifecycle, wiring the pieces above together), `config.ts` (reads VS Code settings),
  `webview/main.ts` (DOM manipulation inside the webview's own sandboxed context — no Node, no
  `vscode`, can't run under Vitest's plain Node environment either way).

This mirrors exactly what the plan's own verification line for this increment asks for: "Unit
tests on message/state handling; manual run in Extension Development Host."

## Running it locally

1. `pnpm --filter @maddox-bot/vscode-extension build` (bundles `src/extension.ts` →
   `dist/extension.cjs` via esbuild, `external: ["vscode"]` since that module only resolves inside
   a running VS Code instance; and `src/webview/main.ts` → `dist/webview.js`, a browser IIFE with
   no external dependencies).
2. Open this folder in VS Code and press F5 ("Run Extension") to launch an Extension Development
   Host window.
3. In that window, set `maddoxBot.apiBaseUrl` (defaults to `http://localhost:3000`) and
   `maddoxBot.repositoryId` in settings — see below for `repositoryId`.
4. Run the command "Maddox Bot: Open Panel".

### Finding a `repositoryId`

There's no registration UI anywhere in this system yet — every `repositories` row in every
increment's tests so far has been created directly via `database.repositories.create(...)`. Until
something (a setup wizard, a CLI) exists to register a real repo, query Postgres directly for the
row's `id` (`docker compose up -d` from the repo root, then `psql` against
`postgresql://maddox:maddox@localhost:5433/maddox_bot`, or `packages/database`'s Prisma client) and
paste it into the setting.

## What's deliberately not here yet

- **No auth.** `apiClient.ts` makes plain unauthenticated requests — matches `apps/api`'s current
  reality (no REST/WS route checks anything yet; see its README). The original plan assumed a
  long-lived local API token in VS Code's `SecretStorage`, but that needs a real place to issue and
  check tokens against, which doesn't exist yet on the server side either.
- **`pause`/`resume` are recognized but not wired.** The parser and chat both know about them (per
  the plan's fixed command set), but reply "not supported yet" rather than doing nothing silently
  or pretending to act — there is no point in the worker's loop that checks for a pause signal, and
  no API surface to send one from (see `apps/worker`'s README). `cancel` **is** real, via `apps/api`'s
  `POST /tasks/:id/cancel`.
- **Opening the panel twice opens two independent panels**, each with its own chat/dashboard state,
  poll timer, and WebSocket connection — rather than revealing an existing one. A real
  single-instance-panel pattern (tracking and disposing the previous one, or just calling
  `reveal()` on it) is a small, self-contained follow-up, not something this increment's "basic"
  scope needed to get right first.
- **The scoped package name (`@maddox-bot/vscode-extension`) matches this monorepo's convention
  for every other package**, which keeps `pnpm --filter`/Turborepo working — but it would need
  changing to a simple, marketplace-legal name before `vsce package`/`vsce publish` could ever run
  against it. Irrelevant for Phase 1 (local Extension Development Host only), so left as-is rather
  than solved for a publishing scenario nothing here needs yet.
- **Session CRUD.** The extension tracks "the current task" purely client-side (`ChatState`,
  reset every time the panel is reopened) rather than against a persisted `agent_sessions` row —
  `apps/api` has no session endpoints yet either.

## Local development

`pnpm --filter @maddox-bot/vscode-extension test` needs no external services — every test either
exercises pure logic or spins up its own local HTTP/WS server. `apps/api` (and, transitively,
compose Postgres/Redis) only need to be running for a real, manual Extension Development Host
session — see `apps/api`'s and `apps/worker`'s READMEs for that setup.
