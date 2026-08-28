import type { ZodType } from "zod";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type AssistantContentBlock = TextBlock | ToolUseBlock;

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type UserContentBlock = TextBlock | ToolResultBlock;

export interface UserMessage {
  role: "user";
  content: string | UserContentBlock[];
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
}

export type ConversationMessage = UserMessage | AssistantMessage;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolChoice = "auto" | "any" | { name: string };

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** "unknown" covers any real stop_reason this package doesn't yet have a narrower case for,
 * rather than throwing on an SDK addition we haven't caught up to. */
export type StopReason =
  "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | "pause_turn" | "refusal" | "unknown";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface GenerateRequest {
  /** Overrides the provider's default model for this call — how a ModelRouter selection reaches a request. */
  model?: string;
  system?: string;
  messages: ConversationMessage[];
  maxTokens?: number;
  effort?: EffortLevel;
}

export interface GenerateResult {
  content: AssistantContentBlock[];
  stopReason: StopReason;
  usage: Usage;
}

export interface ToolCallRequest extends GenerateRequest {
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
}

export type StreamEventType = "text_delta" | "thinking_delta";

export interface StreamEvent {
  type: StreamEventType;
  text: string;
}

export interface StructuredOutputRequest<T> {
  model?: string;
  system?: string;
  messages: ConversationMessage[];
  schemaName: string;
  schema: ZodType<T>;
  maxTokens?: number;
  effort?: EffortLevel;
}

export interface StructuredOutputResult<T> {
  value: T | null;
  stopReason: StopReason;
  usage: Usage;
}
