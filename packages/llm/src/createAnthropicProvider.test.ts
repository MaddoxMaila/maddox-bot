import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn(), parse: vi.fn() },
  })),
}));

const { createAnthropicProvider } = await import("./createAnthropicProvider.js");
const { AnthropicProvider, DEFAULT_MODEL } = await import("./anthropicProvider.js");

describe("createAnthropicProvider", () => {
  it("returns an AnthropicProvider defaulting to claude-opus-5", () => {
    const provider = createAnthropicProvider("test-key");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("accepts an explicit model override", () => {
    const provider = createAnthropicProvider("test-key", "claude-sonnet-5");
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
  });
});
