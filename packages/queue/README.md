# @maddox-bot/queue

A `JobQueue<TData>` interface (enqueue / process / cancel / listFailed / close) with one adapter,
`BullMqJobQueue`, backed by BullMQ + Redis. Kept behind an interface, per the approved plan, so the
queue implementation stays swappable.

## What each `JobQueue` capability maps to

| Plan requirement (spec §25) | How it's realized                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Retry, backoff              | `attempts` / `backoffMs` on `enqueue()`, BullMQ exponential backoff                                                     |
| Dead-letter queue           | `listFailed()` — jobs that exhaust their retry budget stay queryable (`removeOnFail: false`) rather than a separate DLQ |
| Idempotency, deduplication  | `jobId` on `enqueue()` — BullMQ treats adding an existing, not-yet-completed `jobId` as a no-op                         |
| Concurrency limits          | `concurrency` on `process()`                                                                                            |
| Job cancellation            | `cancel(jobId)`                                                                                                         |
| Job priority                | `priority` on `enqueue()`                                                                                               |
| Scheduled jobs              | `delayMs` on `enqueue()` (one-off delay; no cron/repeat support yet — not needed until a Phase 1 workflow asks for it)  |
| Task locking                | BullMQ's own per-job lock during processing — nothing to build                                                          |

A `Queue` and its `Worker` each get their own Redis connection (see `bullmqJobQueue.ts`): a
worker's blocking job-fetch loop would otherwise stall the queue's own commands if they shared one.

## Local development

Requires the compose Redis (`docker compose up -d` from the repo root). Tests default `REDIS_URL`
to `redis://localhost:6380` if it isn't already set — see `src/testRedisUrl.ts`.
