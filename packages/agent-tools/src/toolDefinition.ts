import type { PermissionTier } from "@maddox-bot/permissions";
import type { ZodType } from "zod";

export interface ToolExecutionContext {
  taskId: string;
  workspaceId: string;
  role: "planner" | "implementation_agent";
  requestApproval: (summary: string) => Promise<"approved" | "denied">;
}

export interface ToolExecutionOutcome<T = unknown> {
  ok: boolean;
  output?: T;
  error?: { code: string; message: string };
}

export interface ToolResult<T = unknown> extends ToolExecutionOutcome<T> {
  /** Measured once, by the registry, wrapping validation + permission-check + execution — not
   * duplicated per tool — so it's directly comparable across every tool regardless of which path
   * (denied, errored, succeeded) produced the result. */
  durationMs: number;
  /** Absent when the call never reached classification (unknown_tool, invalid_input) — present for
   * every other outcome. The one source of truth for what actually gated this call, so a caller
   * persisting an audit row (agent-core) never has to re-classify with its own PermissionGate
   * instance and risk disagreeing with the decision that was actually enforced. */
  permission?: { tier: PermissionTier; reason: string };
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  // Method-shorthand syntax deliberately, not a function-typed property: TypeScript checks method
  // signatures bivariantly, which is what lets a ToolDefinition<Specific> stand in for
  // ToolDefinition<unknown> in a heterogeneous ToolDefinition[] — the standard pattern for a
  // collection of internally-consistent handlers with erased, differing input types. A
  // function-typed property here would get strict contravariant checking and reject every tool.
  execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolExecutionOutcome<TOutput>>;
}
