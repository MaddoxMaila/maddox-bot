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
