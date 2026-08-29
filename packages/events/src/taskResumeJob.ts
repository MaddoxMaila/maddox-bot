/**
 * What the API enqueues when a human decides an approval (via `POST /approvals/:id/decide`) —
 * a nudge telling the worker "re-check this task's state and continue if it can." Deliberately not
 * "the approval was approved, go implement now": the worker's own taskRunner.ts already knows how
 * to read a task's current state and decide what (if anything) to do next, the same dispatch it
 * uses for a freshly created task or a crash-recovered one. Lives alongside AgentTriggerJobPayload
 * for the same reason: the producer (apps/api) and the consumer (apps/worker) must agree on the
 * exact shape, and apps don't depend on each other.
 */
export interface TaskResumeJobPayload {
  taskId: string;
}
