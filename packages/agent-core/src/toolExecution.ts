import type { ToolExecutionContext, ToolRegistry, ToolResult } from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Executes one tool call and persists its tool_calls/tool_results audit row — the single path both
 * AgentLoopRunner (an LLM-driven tool_use turn) and ImplementationAgentRunner (a programmatic gate
 * check, e.g. running shell.run_tests directly) go through, so every tool invocation is recorded
 * identically regardless of who decided to make it.
 */
export async function executeAndRecordTool(
  database: Database,
  toolRegistry: ToolRegistry,
  taskId: string,
  role: "planner" | "implementation_agent",
  toolName: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const outcome = await toolRegistry.execute(toolName, input, ctx);

  await database.toolCalls.createCompleted({
    taskId,
    role,
    toolName,
    input: isRecord(input) ? input : { value: input },
    permissionDecision: outcome.permission?.tier ?? "not_classified",
    result: {
      ok: outcome.ok,
      durationMs: outcome.durationMs,
      ...(outcome.output !== undefined && { output: outcome.output }),
      ...(outcome.error !== undefined && { error: outcome.error }),
    },
  });

  return outcome;
}
