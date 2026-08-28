import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockStream, mockParse, mockZodOutputFormat } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
  mockParse: vi.fn(),
  mockZodOutputFormat: vi.fn().mockReturnValue({ type: "json_schema", sentinel: true }),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream, parse: mockParse },
  })),
}));

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: mockZodOutputFormat,
}));

const AnthropicModule = await import("@anthropic-ai/sdk");
const { createAnthropicAdapter } = await import("./anthropicAdapter.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockZodOutputFormat.mockReturnValue({ type: "json_schema", sentinel: true });
});

describe("createAnthropicAdapter", () => {
  it("constructs the SDK client with the given API key", () => {
    createAnthropicAdapter("test-key");
    expect(AnthropicModule.default).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("createMessage delegates to messages.create", async () => {
    mockCreate.mockResolvedValue({ id: "msg_1" });
    const adapter = createAnthropicAdapter("test-key");

    const params = { model: "claude-opus-5", max_tokens: 100, messages: [] } as never;
    const result = await adapter.createMessage(params);

    expect(mockCreate).toHaveBeenCalledWith(params);
    expect(result).toEqual({ id: "msg_1" });
  });

  it("streamMessage delegates to messages.stream", () => {
    const fakeStream = { finalMessage: vi.fn() };
    mockStream.mockReturnValue(fakeStream);
    const adapter = createAnthropicAdapter("test-key");

    const params = { model: "claude-opus-5", max_tokens: 100, messages: [] } as never;
    const result = adapter.streamMessage(params);

    expect(mockStream).toHaveBeenCalledWith(params);
    expect(result).toBe(fakeStream);
  });

  it("parseMessage builds output_config from the schema via zodOutputFormat", async () => {
    mockParse.mockResolvedValue({
      parsed_output: { ok: true },
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const adapter = createAnthropicAdapter("test-key");
    const schema = z.object({ ok: z.boolean() });

    const result = await adapter.parseMessage(
      { model: "claude-opus-5", max_tokens: 100, messages: [] } as never,
      schema,
    );

    expect(mockZodOutputFormat).toHaveBeenCalledWith(schema);
    expect(mockParse).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: { format: { type: "json_schema", sentinel: true } },
      }),
    );
    expect(result).toEqual({
      parsed_output: { ok: true },
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
});
