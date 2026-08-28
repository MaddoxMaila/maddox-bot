import type { ToolDefinition as AgentToolDefinition } from "@maddox-bot/agent-tools";
import type { ToolDefinition as LLMToolDefinition } from "@maddox-bot/llm";
import { z } from "zod";

/**
 * agent-tools describes each tool's input with a live Zod schema (for runtime validation); the LLM
 * package describes it as a plain JSON Schema object (what actually goes on the wire to Claude).
 * `z.toJSONSchema` always injects a top-level `$schema` key that Anthropic's tool `input_schema`
 * has no use for, so it's stripped here rather than sent along.
 */
export function toLLMToolDefinitions(tools: AgentToolDefinition[]): LLMToolDefinition[] {
  return tools.map((tool) => {
    const { $schema: _$schema, ...inputSchema } = z.toJSONSchema(tool.inputSchema);
    return { name: tool.name, description: tool.description, inputSchema };
  });
}
