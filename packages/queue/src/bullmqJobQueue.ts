import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { EnqueueOptions, FailedJob, JobHandle, JobQueue, ProcessOptions } from "./jobQueue.js";

export interface BullMqJobQueueOptions {
  redisUrl: string;
  defaultAttempts?: number;
  defaultBackoffMs?: number;
}

function createConnection(redisUrl: string): Redis {
  // BullMQ requires this on any connection it drives; without it, blocking calls (used by the
  // worker's job-fetch loop) retry forever instead of surfacing a connection error.
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

// Every job added through this class uses the same literal job name ("job") — only the payload
// varies. Queue<DataTypeOrJob, ...> derives its `add()` name parameter's type via a conditional
// type keyed on DataTypeOrJob; when DataTypeOrJob is this class's own unresolved generic `TData`,
// that conditional type can't reduce to a concrete type, so passing the literal "job" fails to
// typecheck. Pinning every generic position explicitly (rather than leaving the later ones to
// their computed defaults) sidesteps that unresolved conditional entirely.
type BullQueue<TData> = Queue<TData, void, string, TData, void, string>;
type BullWorker<TData> = Worker<TData, void, string>;

/**
 * A Queue and a Worker each get their own Redis connection rather than sharing one: the worker
 * holds a long-lived blocking connection while it waits for jobs, which would stall the queue's
 * own (non-blocking) commands if they shared a connection.
 */
export class BullMqJobQueue<TData = unknown> implements JobQueue<TData> {
  private readonly redisUrl: string;
  private readonly queueConnection: Redis;
  private readonly queue: BullQueue<TData>;
  private readonly defaultAttempts: number;
  private readonly defaultBackoffMs: number;
  private workerConnection: Redis | undefined;
  private worker: BullWorker<TData> | undefined;

  constructor(name: string, options: BullMqJobQueueOptions) {
    this.redisUrl = options.redisUrl;
    this.defaultAttempts = options.defaultAttempts ?? 3;
    this.defaultBackoffMs = options.defaultBackoffMs ?? 5000;
    this.queueConnection = createConnection(this.redisUrl);
    this.queue = new Queue<TData, void, string, TData, void, string>(name, {
      connection: this.queueConnection,
    });
  }

  async enqueue(data: TData, options: EnqueueOptions = {}): Promise<JobHandle> {
    const job = await this.queue.add("job", data, {
      ...(options.jobId !== undefined && { jobId: options.jobId }),
      ...(options.priority !== undefined && { priority: options.priority }),
      ...(options.delayMs !== undefined && { delay: options.delayMs }),
      attempts: options.attempts ?? this.defaultAttempts,
      backoff: { type: "exponential", delay: options.backoffMs ?? this.defaultBackoffMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
    return { id: job.id ?? "" };
  }

  process(
    handler: (data: TData, jobId: string) => Promise<void>,
    options: ProcessOptions = {},
  ): void {
    this.workerConnection = createConnection(this.redisUrl);
    this.worker = new Worker<TData, void, string>(
      this.queue.name,
      async (job) => {
        await handler(job.data, job.id ?? "");
      },
      { connection: this.workerConnection, concurrency: options.concurrency ?? 1 },
    );
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return false;
    }
    await job.remove();
    return true;
  }

  async listFailed(): Promise<FailedJob<TData>[]> {
    const jobs = await this.queue.getFailed();
    return jobs.map((job) => ({
      id: job.id ?? "",
      data: job.data,
      failedReason: job.failedReason ?? "",
    }));
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.workerConnection?.disconnect();
    await this.queue.close();
    this.queueConnection.disconnect();
  }
}
