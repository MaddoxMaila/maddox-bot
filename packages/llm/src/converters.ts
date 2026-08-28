import type Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantContentBlock,
  ConversationMessage,
  StopReason,
  ToolChoice,
  ToolDefinition,
  Usage,
} from "./types.js";

export function toAnthropicMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        return { role: "user", content: message.content };
      }
      return {
        role: "user",
        content: message.content.map((block) =>
          block.type === "text"
            ? { type: "text" as const, text: block.text }
            : {
                type: "tool_result" as const,
                tool_use_id: block.toolUseId,
                content: block.content,
                ...(block.isError !== undefined && { is_error: block.isError }),
              },
        ),
      };
    }
    return {
      role: "assistant",
      content: message.content.map((block) =>
        block.type === "text"
          ? { type: "text" as const, text: block.text }
          : { type: "tool_use" as const, id: block.id, name: block.name, input: block.input },
      ),
    };
  });
}

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { type: "object", ...tool.inputSchema },
  }));
}

export function toAnthropicToolChoice(choice: ToolChoice | undefined): Anthropic.ToolChoice {
  if (choice === undefined || choice === "auto") {
    return { type: "auto" };
  }
  if (choice === "any") {
    return { type: "any" };
  }
  return { type: "tool", name: choice.name };
}

// Phase 1 only uses client-side custom tools, so only text/tool_use content is meaningful here.
// Other real block types (thinking, server-tool results, ...) aren't structurally represented in
// AssistantContentBlock yet — silently dropped rather than thrown on, since a provider-abstraction
// caller shouldn't break when Claude includes a block this package doesn't model.
export function fromAnthropicContent(content: Anthropic.ContentBlock[]): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
  }
  return blocks;
}

const KNOWN_STOP_REASONS: readonly StopReason[] = [
  "end_turn",
  "max_tokens",
  "tool_use",
  "stop_sequence",
  "pause_turn",
  "refusal",
];

export function fromAnthropicStopReason(stopReason: string | null): StopReason {
  if (stopReason !== null && (KNOWN_STOP_REASONS as readonly string[]).includes(stopReason)) {
    return stopReason as StopReason;
  }
  return "unknown";
}

export function fromAnthropicUsage(usage: Anthropic.Usage): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
