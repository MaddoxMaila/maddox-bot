import type { ToolRegistry } from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";
import type { LLMProvider } from "@maddox-bot/llm";
import { AgentLoopRunner } from "./agentLoopRunner.js";
import { buildPlannerContext, type PlannerContextInput } from "./contextBuilder.js";
import { implementationPlanSchema, type ImplementationPlan } from "./implementationPlan.js";
import { TaskStateMachine } from "./taskStateMachine.js";

const FINAL_PLAN_PROMPT = "Based on your investigation, produce the final implementation plan.";

export interface PlannerRunnerDeps {
  llm: LLMProvider;
  model: string;
  toolRegistry: ToolRegistry;
  database: Database;
  requestApproval: (summary: string) => Promise<"approved" | "denied">;
  maxToolCalls?: number;
  maxDurationMs?: number;
}

export interface PlannerRunInput {
  taskId: string;
  workspaceId: string;
  context: PlannerContextInput;
}

export interface PlannerRunResult {
  plan: ImplementationPlan | null;
  toolCallCount: number;
  stopReason: "completed" | "max_tool_calls" | "timeout";
}

/**
 * The Planner role: ANALYZING -> PLANNED (approved plan, section 6). Ends at PLANNED on success —
 * the PLANNED -> AWAITING_APPROVAL transition, and creating the plan_approval Approval row it
 * implies, belongs to the worker orchestration loop that reacts to a completed Planner run
 * (increment 14+), not to the role-run itself.
 */
export class PlannerRunner {
  private readonly stateMachine: TaskStateMachine;
  private readonly loopRunner: AgentLoopRunner;

  constructor(private readonly deps: PlannerRunnerDeps) {
    this.stateMachine = new TaskStateMachine(deps.database);
    this.loopRunner = new AgentLoopRunner(deps.llm, deps.toolRegistry, deps.database);
  }

  async run(input: PlannerRunInput): Promise<PlannerRunResult> {
    const { system, messages } = buildPlannerContext(input.context);

    await this.stateMachine.transition(input.taskId, "CREATED", "ANALYZING");

    const loopResult = await this.loopRunner.run(
      { id: input.taskId, workspaceId: input.workspaceId },
      {
        role: "planner",
        system,
        tools: this.deps.toolRegistry.list(),
        model: this.deps.model,
        ...(this.deps.maxToolCalls !== undefined && { maxToolCalls: this.deps.maxToolCalls }),
        ...(this.deps.maxDurationMs !== undefined && { maxDurationMs: this.deps.maxDurationMs }),
        requestApproval: this.deps.requestApproval,
        structuredOutput: {
          schemaName: "ImplementationPlan",
          schema: implementationPlanSchema,
          prompt: FINAL_PLAN_PROMPT,
        },
      },
      messages,
    );

    if (loopResult.output !== null) {
      await this.deps.database.agentTasks.updatePlan(input.taskId, loopResult.output);
      await this.deps.database.taskEvents.create({
        taskId: input.taskId,
        type: "plan_produced",
        payload: { toolCallCount: loopResult.toolCallCount, stopReason: loopResult.stopReason },
      });
      await this.stateMachine.transition(input.taskId, "ANALYZING", "PLANNED");
    } else {
      await this.deps.database.taskEvents.create({
        taskId: input.taskId,
        type: "planning_failed",
        payload: { toolCallCount: loopResult.toolCallCount, stopReason: loopResult.stopReason },
      });
      await this.stateMachine.transition(input.taskId, "ANALYZING", "BLOCKED");
    }

    return {
      plan: loopResult.output,
      toolCallCount: loopResult.toolCallCount,
      stopReason: loopResult.stopReason,
    };
  }
}
