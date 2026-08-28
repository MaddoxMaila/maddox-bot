import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  fromAnthropicContent,
  fromAnthropicStopReason,
  fromAnthropicUsage,
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicToolChoice,
} from "./converters.js";

describe("toAnthropicMessages", () => {
  it("passes a plain-string user message through unchanged", () => {
    expect(toAnthropicMessages([{ role: "user", content: "hello" }])).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("maps user content blocks: text and tool_result", () => {
    const result = toAnthropicMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "here's the result" },
          { type: "tool_result", toolUseId: "tu_1", content: "42" },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "here's the result" },
          { type: "tool_result", tool_use_id: "tu_1", content: "42" },
        ],
      },
    ]);
  });

  it("includes is_error only when set on a tool_result block", () => {
    const result = toAnthropicMessages([
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "tu_1", content: "boom", isError: true }],
      },
    ]);
    expect(result[0]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }],
    });
  });

  it("maps assistant content blocks: text and tool_use", () => {
    const result = toAnthropicMessages([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } },
        ],
      },
    ]);
  });
});

describe("toAnthropicTools", () => {
  it("maps name/description/inputSchema and forces an object-type schema", () => {
    const result = toAnthropicTools([
      {
        name: "get_weather",
        description: "Get current weather",
        inputSchema: { properties: { city: { type: "string" } }, required: ["city"] },
      },
    ]);
    expect(result).toEqual([
      {
        name: "get_weather",
        description: "Get current weather",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ]);
  });
});

describe("toAnthropicToolChoice", () => {
  it("defaults to auto when undefined", () => {
    expect(toAnthropicToolChoice(undefined)).toEqual({ type: "auto" });
  });

  it("maps the 'auto' and 'any' string literals", () => {
    expect(toAnthropicToolChoice("auto")).toEqual({ type: "auto" });
    expect(toAnthropicToolChoice("any")).toEqual({ type: "any" });
  });

  it("maps a named tool choice", () => {
    expect(toAnthropicToolChoice({ name: "get_weather" })).toEqual({
      type: "tool",
      name: "get_weather",
    });
  });
});

describe("fromAnthropicContent", () => {
  it("maps text and tool_use blocks", () => {
    const content = [
      { type: "text", text: "hi", citations: null },
      { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } },
    ] as unknown as Anthropic.ContentBlock[];
    expect(fromAnthropicContent(content)).toEqual([
      { type: "text", text: "hi" },
      { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } },
    ]);
  });

  it("silently drops block types this package doesn't model (e.g. thinking)", () => {
    const content = [
      { type: "thinking", thinking: "reasoning...", signature: "sig" },
      { type: "text", text: "the answer", citations: null },
    ] as unknown as Anthropic.ContentBlock[];
    expect(fromAnthropicContent(content)).toEqual([{ type: "text", text: "the answer" }]);
  });
});

describe("fromAnthropicStopReason", () => {
  it.each([
    ["end_turn", "end_turn"],
    ["max_tokens", "max_tokens"],
    ["tool_use", "tool_use"],
    ["stop_sequence", "stop_sequence"],
    ["pause_turn", "pause_turn"],
    ["refusal", "refusal"],
  ] as const)("maps known stop reason %s", (input, expected) => {
    expect(fromAnthropicStopReason(input)).toBe(expected);
  });

  it("maps null and unrecognized values to 'unknown'", () => {
    expect(fromAnthropicStopReason(null)).toBe("unknown");
    expect(fromAnthropicStopReason("some_future_reason")).toBe("unknown");
  });
});

describe("fromAnthropicUsage", () => {
  it("maps snake_case usage fields to camelCase, defaulting missing cache fields to 0", () => {
    const usage = { input_tokens: 100, output_tokens: 50 } as Anthropic.Usage;
    expect(fromAnthropicUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
  });

  it("carries through cache token counts when present", () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 20,
    } as Anthropic.Usage;
    expect(fromAnthropicUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 20,
    });
  });
});
