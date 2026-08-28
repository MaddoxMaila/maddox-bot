import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { AnthropicClientLike } from "./anthropicClientLike.js";
import { AnthropicProvider, DEFAULT_MODEL } from "./anthropicProvider.js";

function fakeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text: "hello", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

function fakeStream(
  events: Array<{ type: string; delta?: { type: string; text?: string; thinking?: string } }>,
  finalMessage: Anthropic.Message,
): MessageStream {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: async () => {
          if (index < events.length) {
            return { done: false, value: events[index++] };
          }
          return { done: true, value: undefined };
        },
      };
    },
    finalMessage: async () => finalMessage,
  } as unknown as MessageStream;
}

function fakeClient(overrides: Partial<AnthropicClientLike> = {}): AnthropicClientLike {
  return {
    createMessage: vi.fn().mockResolvedValue(fakeMessage()),
    streamMessage: vi.fn().mockReturnValue(fakeStream([], fakeMessage())),
    parseMessage: vi.fn().mockResolvedValue({
      parsed_output: null,
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    ...overrides,
  };
}

describe("AnthropicProvider.generate", () => {
  it("maps the response and defaults to the provider's model and max tokens", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client, DEFAULT_MODEL);

    const result = await provider.generate({ messages: [{ role: "user", content: "hi" }] });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_MODEL, max_tokens: 16000 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
      stopReason: "end_turn",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
  });

  it("a per-call model override wins over the provider's default", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client, DEFAULT_MODEL);

    await provider.generate({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" }),
    );
  });

  it("wraps a given system prompt in a cached text block", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.generate({
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [{ type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } }],
      }),
    );
  });

  it("omits system and output_config entirely when not provided", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.generate({ messages: [{ role: "user", content: "hi" }] });

    const call = vi.mocked(client.createMessage).mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("system");
    expect(call).not.toHaveProperty("output_config");
  });

  it("passes effort through as output_config.effort", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.generate({ messages: [{ role: "user", content: "hi" }], effort: "xhigh" });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ output_config: { effort: "xhigh" } }),
    );
  });

  it("respects an explicit maxTokens", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.generate({ messages: [{ role: "user", content: "hi" }], maxTokens: 500 });

    expect(client.createMessage).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 500 }));
  });
});

describe("AnthropicProvider.stream", () => {
  it("emits text and thinking deltas via the callback and returns the final message", async () => {
    const client = fakeClient({
      streamMessage: vi.fn().mockReturnValue(
        fakeStream(
          [
            { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
            { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
            {
              type: "content_block_delta",
              delta: { type: "thinking_delta", thinking: "pondering" },
            },
          ],
          fakeMessage({ content: [{ type: "text", text: "Hello", citations: null }] }),
        ),
      ),
    });
    const provider = new AnthropicProvider(client);
    const events: Array<{ type: string; text: string }> = [];

    const result = await provider.stream({ messages: [{ role: "user", content: "hi" }] }, (event) =>
      events.push(event),
    );

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "thinking_delta", text: "pondering" },
    ]);
    expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("defaults to a larger max_tokens than generate(), since timeouts aren't a concern when streaming", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.stream({ messages: [{ role: "user", content: "hi" }] }, () => {});

    expect(client.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 64000 }),
    );
  });
});

describe("AnthropicProvider.toolCall", () => {
  it("includes tools and defaults tool_choice to auto", async () => {
    const client = fakeClient({
      createMessage: vi.fn().mockResolvedValue(
        fakeMessage({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "get_weather",
              input: { city: "Paris" },
              caller: { type: "direct" },
            },
          ],
          stop_reason: "tool_use",
        }),
      ),
    });
    const provider = new AnthropicProvider(client);

    const result = await provider.toolCall({
      messages: [{ role: "user", content: "weather in Paris?" }],
      tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
    });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
        ],
        tool_choice: { type: "auto" },
      }),
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } },
    ]);
  });

  it("forwards an explicit toolChoice", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    await provider.toolCall({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      toolChoice: { name: "get_weather" },
    });

    expect(client.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: { type: "tool", name: "get_weather" } }),
    );
  });
});

describe("AnthropicProvider.structuredOutput", () => {
  const PlanSchema = z.object({ files: z.array(z.string()) });

  it("returns the parsed value and passes the schema through to the client", async () => {
    const client = fakeClient({
      parseMessage: vi.fn().mockResolvedValue({
        parsed_output: { files: ["src/index.ts"] },
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    const provider = new AnthropicProvider(client);

    const result = await provider.structuredOutput({
      messages: [{ role: "user", content: "plan it" }],
      schemaName: "Plan",
      schema: PlanSchema,
    });

    expect(client.parseMessage).toHaveBeenCalledWith(expect.any(Object), PlanSchema);
    expect(result.value).toEqual({ files: ["src/index.ts"] });
  });

  it("surfaces a null value when the response didn't parse (never fabricated)", async () => {
    const client = fakeClient();
    const provider = new AnthropicProvider(client);

    const result = await provider.structuredOutput({
      messages: [{ role: "user", content: "plan it" }],
      schemaName: "Plan",
      schema: PlanSchema,
    });

    expect(result.value).toBeNull();
  });
});
