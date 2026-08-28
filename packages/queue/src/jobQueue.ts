export interface EnqueueOptions {
  /** Also used for dedupe: adding a job with an ID already present (and not yet completed) is a no-op. */
  jobId?: string;
  priority?: number;
  delayMs?: number;
  attempts?: number;
  backoffMs?: number;
}

export interface JobHandle {
  id: string;
}

export interface ProcessOptions {
  concurrency?: number;
}

export interface FailedJob<TData> {
  id: string;
  data: TData;
  failedReason: string;
}

export interface JobQueue<TData = unknown> {
  enqueue(data: TData, options?: EnqueueOptions): Promise<JobHandle>;
  process(handler: (data: TData, jobId: string) => Promise<void>, options?: ProcessOptions): void;
  cancel(jobId: string): Promise<boolean>;
  /** The dead-letter record: jobs that exhausted their retry budget, kept for inspection. */
  listFailed(): Promise<FailedJob<TData>[]>;
  close(): Promise<void>;
}
