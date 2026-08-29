import type { TaskState } from "@maddox-bot/shared";
import { runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

// Every non-terminal, non-paused state a task could have been left in by a worker process that
// died — runTask's own recoverIfStuck() does the actual recovery decision per task; this is just
// "which tasks need looking at" on boot. PLANNED/AWAITING_APPROVAL aren't "stuck" in the crash
// sense (no in-progress work was lost — planning already finished, or nothing has started yet) but
// still need runTask called on them since a crash could have happened between the API creating a
// job and the worker acting on it, or right after a transition with autoApprovePlans on.
const NEEDS_ATTENTION_ON_BOOT: readonly TaskState[] = [
  "ANALYZING",
  "PLANNED",
  "AWAITING_APPROVAL",
  "IMPLEMENTING",
  "TESTING",
  "FIXING",
  "SELF_REVIEW",
  "PR_CREATED",
];

/**
 * Called once at worker startup: finds every task left in a non-terminal, non-paused state —
 * whether by a crash mid-task or simply because the process restarted between two steps — and
 * resumes each one. A task with nothing to do (e.g. AWAITING_APPROVAL with autoApprovePlans off)
 * is a fast no-op via runTask's own state check, so calling this liberally on every boot is safe.
 */
export async function recoverStuckTasksOnStartup(deps: WorkerDependencies): Promise<void> {
  const stuckTasks = await deps.database.agentTasks.listByStates([...NEEDS_ATTENTION_ON_BOOT]);
  if (stuckTasks.length === 0) {
    return;
  }
  deps.logger.info(
    { count: stuckTasks.length, taskIds: stuckTasks.map((task) => task.id) },
    "resuming tasks left in progress from a previous run",
  );

  for (const task of stuckTasks) {
    try {
      await runTask(deps, task.id);
    } catch (error) {
      deps.logger.error(
        { err: error, taskId: task.id },
        "failed to resume a task on startup — leaving it for the next attempt",
      );
    }
  }
}
