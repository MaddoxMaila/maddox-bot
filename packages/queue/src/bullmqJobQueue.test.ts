import { createId } from "@maddox-bot/shared";
import { afterEach, describe, expect, it } from "vitest";
import { BullMqJobQueue } from "./bullmqJobQueue.js";
import { testRedisUrl } from "./testRedisUrl.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("BullMqJobQueue", () => {
  let queue: BullMqJobQueue<{ message: string }> | undefined;

  afterEach(async () => {
    await queue?.close();
    queue = undefined;
  });

  it("enqueues a job and delivers it to the processor", async () => {
    queue = new BullMqJobQueue(`test-${createId()}`, { redisUrl: testRedisUrl() });
    const received = defer<{ message: string }>();

    queue.process(async (data) => {
      received.resolve(data);
    });
    await queue.enqueue({ message: "hello" });

    await expect(received.promise).resolves.toEqual({ message: "hello" });
  }, 10000);

  it("retries a failing job up to the attempt limit, then succeeds if it recovers", async () => {
    queue = new BullMqJobQueue(`test-${createId()}`, {
      redisUrl: testRedisUrl(),
      defaultBackoffMs: 10,
    });
    let attemptCount = 0;
    const succeeded = defer<void>();

    queue.process(async () => {
      attemptCount += 1;
      if (attemptCount < 2) {
        throw new Error("transient failure");
      }
      succeeded.resolve();
    });
    await queue.enqueue({ message: "retry-me" }, { attempts: 3, backoffMs: 10 });

    await succeeded.promise;
    expect(attemptCount).toBe(2);
  }, 10000);

  it("dedupes by jobId: adding the same jobId twice only runs the handler once", async () => {
    queue = new BullMqJobQueue(`test-${createId()}`, { redisUrl: testRedisUrl() });
    let callCount = 0;
    const first = defer<void>();

    queue.process(async () => {
      callCount += 1;
      first.resolve();
    });

    const dedupeKey = `dedupe-${createId()}`;
    await queue.enqueue({ message: "one" }, { jobId: dedupeKey });
    await queue.enqueue({ message: "one" }, { jobId: dedupeKey });

    await first.promise;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(callCount).toBe(1);
  }, 10000);

  it("records a job in listFailed once it exhausts its retry budget", async () => {
    queue = new BullMqJobQueue(`test-${createId()}`, {
      redisUrl: testRedisUrl(),
      defaultBackoffMs: 10,
    });
    const failed = defer<void>();
    let attemptCount = 0;

    queue.process(async () => {
      attemptCount += 1;
      if (attemptCount === 2) {
        failed.resolve();
      }
      throw new Error("permanent failure");
    });
    const { id } = await queue.enqueue({ message: "always-fails" }, { attempts: 2, backoffMs: 10 });

    await failed.promise;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const failedJobs = await queue.listFailed();
    expect(failedJobs.some((job) => job.id === id && job.failedReason.includes("permanent"))).toBe(
      true,
    );
  }, 10000);

  it("cancel removes a job that has not run yet", async () => {
    queue = new BullMqJobQueue(`test-${createId()}`, { redisUrl: testRedisUrl() });
    const { id } = await queue.enqueue({ message: "cancel-me" }, { delayMs: 60000 });

    const cancelled = await queue.cancel(id);
    expect(cancelled).toBe(true);

    const cancelledAgain = await queue.cancel(id);
    expect(cancelledAgain).toBe(false);
  });
});
