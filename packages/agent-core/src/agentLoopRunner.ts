import type {
  ToolDefinition as AgentToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
} from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";
import type {
  ConversationMessage,
  LLMProvider,
  ToolResultBlock,
  ToolUseBlock,
} from "@maddox-bot/llm";
import type { ZodType } from "zod";
import { toLLMToolDefinitions } from "./toolConversion.js";

const DEFAULT_MAX_TOOL_CALLS = 40;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;

export interface StructuredOutputConfig<TOutput> {
  schemaName: string;
  schema: ZodType<TOutput>;
  /** Appended as a final user message once the model stops calling tools, before the structured call. */
  prompt: string;
}

export interface AgentLoopOptions<TOutput = void> {
  role: "planner" | "implementation_agent";
  system: string;
  tools: AgentToolDefinition[];
  model: string;
  maxToolCalls?: number;
  maxDurationMs?: number;
  requestApproval: (summary: string) => Promise<"approved" | "denied">;
  /** Omitted for a role (e.g. the Implementation Agent) whose output is its side effects, not a
   * final schema-shaped answer. */
  structuredOutput?: StructuredOutputConfig<TOutput>;
}

export interface AgentLoopResult<TOutput = void> {
  messages: ConversationMessage[];
  toolCallCount: number;
  output: TOutput | null;
  stopReason: "completed" | "max_tool_calls" | "timeout";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Drives a manual tool-use loop rather than the Anthropic SDK's own tool runner: this is what lets
 * every tool call be persisted (tool_calls/tool_results) as it happens, so a crashed worker can
 * resume a task from Postgres instead of losing an in-progress role-run (spec §39). Shared by every
 * role (Planner today; Implementation Agent from increment 13) — a role is just an AgentLoopOptions
 * value, not a separate code path.
 *
 * The tool-call bound is checked between turns, not mid-turn: once a turn's tool_use blocks start
 * being executed, all of them run before the bound is checked again, so the transcript handed back
 * to the model (and persisted for resumption) never has an assistant turn with more tool_use blocks
 * than the following user turn has matching tool_results. This can overshoot maxToolCalls by at
 * most one turn's worth of calls — an acceptable, simpler trade against a genuinely malformed
 * conversation history.
 */
export class AgentLoopRunner {
  constructor(
    private readonly llm: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly database: Database,
    private readonly now: () => number = Date.now,
  ) {}

  async run<TOutput = void>(
    task: { id: string; workspaceId: string },
    options: AgentLoopOptions<TOutput>,
    initialMessages: ConversationMessage[],
  ): Promise<AgentLoopResult<TOutput>> {
    const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    const deadline = this.now() + (options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS);
    const llmTools = toLLMToolDefinitions(options.tools);
    const ctx: ToolExecutionContext = {
      taskId: task.id,
      workspaceId: task.workspaceId,
      role: options.role,
      requestApproval: options.requestApproval,
    };

    let messages = [...initialMessages];
    let toolCallCount = 0;

    for (;;) {
      if (toolCallCount >= maxToolCalls) {
        return { messages, toolCallCount, output: null, stopReason: "max_tool_calls" };
      }
      if (this.now() >= deadline) {
        return { messages, toolCallCount, output: null, stopReason: "timeout" };
      }

      const turn = await this.llm.toolCall({
        model: options.model,
        system: options.system,
        messages,
        tools: llmTools,
      });
      messages = [...messages, { role: "assistant", content: turn.content }];

      const toolUseBlocks = turn.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use",
      );

      if (toolUseBlocks.length === 0) {
        return this.finalize(options, messages, toolCallCount);
      }

      const resultBlocks: ToolResultBlock[] = [];
      for (const block of toolUseBlocks) {
        toolCallCount++;
        resultBlocks.push(await this.executeAndRecord(task.id, options.role, block, ctx));
      }

      messages = [...messages, { role: "user", content: resultBlocks }];
    }
  }

  private async executeAndRecord(
    taskId: string,
    role: AgentLoopOptions["role"],
    block: ToolUseBlock,
    ctx: ToolExecutionContext,
  ): Promise<ToolResultBlock> {
    const outcome = await this.toolRegistry.execute(block.name, block.input, ctx);

    await this.database.toolCalls.createCompleted({
      taskId,
      role,
      toolName: block.name,
      input: isRecord(block.input) ? block.input : { value: block.input },
      permissionDecision: outcome.permission?.tier ?? "not_classified",
      result: {
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        ...(outcome.output !== undefined && { output: outcome.output }),
        ...(outcome.error !== undefined && { error: outcome.error }),
      },
    });

    const content = outcome.ok
      ? JSON.stringify(outcome.output ?? null)
      : (outcome.error?.message ?? "Unknown error");
    return {
      type: "tool_result",
      toolUseId: block.id,
      content,
      ...(outcome.ok === false && { isError: true }),
    };
  }

  private async finalize<TOutput>(
    options: AgentLoopOptions<TOutput>,
    messages: ConversationMessage[],
    toolCallCount: number,
  ): Promise<AgentLoopResult<TOutput>> {
    if (!options.structuredOutput) {
      return { messages, toolCallCount, output: null, stopReason: "completed" };
    }

    const finalMessages: ConversationMessage[] = [
      ...messages,
      { role: "user", content: options.structuredOutput.prompt },
    ];
    const structured = await this.llm.structuredOutput({
      model: options.model,
      system: options.system,
      messages: finalMessages,
      schemaName: options.structuredOutput.schemaName,
      schema: options.structuredOutput.schema,
    });

    return {
      messages: finalMessages,
      toolCallCount,
      output: structured.value,
      stopReason: "completed",
    };
  }
}
