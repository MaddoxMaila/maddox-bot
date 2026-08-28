import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicClientLike } from "./anthropicClientLike.js";
import {
  fromAnthropicContent,
  fromAnthropicStopReason,
  fromAnthropicUsage,
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicToolChoice,
} from "./converters.js";
import type { LLMProvider } from "./llmProvider.js";
import type {
  EffortLevel,
  GenerateRequest,
  GenerateResult,
  StreamEvent,
  StructuredOutputRequest,
  StructuredOutputResult,
  ToolCallRequest,
} from "./types.js";

const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_STREAM_MAX_TOKENS = 64000;

export const DEFAULT_MODEL = "claude-opus-5";

interface CommonParams {
  model: string;
  max_tokens: number;
  messages: Anthropic.MessageParam[];
  system?: Anthropic.TextBlockParam[];
  output_config?: { effort: EffortLevel };
}

export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly client: AnthropicClientLike,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  /**
   * Caches the stable system prompt (+ tool schemas, which render immediately after system in
   * the request) so repeated calls with the same prompt only pay full price once. Caching is a
   * prefix match — any byte change here invalidates it, so callers should keep this text stable
   * across calls for the same concern rather than interpolating per-request values into it.
   *
   * Built as a single object (not assembled via a repeated conditional-spread-on-a-function-call)
   * because exactOptionalPropertyTypes rejects `system: undefined` as a present-but-empty key —
   * computing each optional field once into a local, then spreading only when defined, is what
   * actually omits the key rather than setting it to undefined.
   */
  private buildCommonParams(
    request: GenerateRequest,
    maxTokens: number,
    fallbackModel: string,
  ): CommonParams {
    const system = request.system
      ? [
          {
            type: "text" as const,
            text: request.system,
            cache_control: { type: "ephemeral" as const },
          },
        ]
      : undefined;
    return {
      model: request.model ?? fallbackModel,
      max_tokens: request.maxTokens ?? maxTokens,
      messages: toAnthropicMessages(request.messages),
      ...(system !== undefined && { system }),
      ...(request.effort !== undefined && { output_config: { effort: request.effort } }),
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.createMessage(
      this.buildCommonParams(request, DEFAULT_MAX_TOKENS, this.model),
    );
    return {
      content: fromAnthropicContent(response.content),
      stopReason: fromAnthropicStopReason(response.stop_reason),
      usage: fromAnthropicUsage(response.usage),
    };
  }

  async stream(
    request: GenerateRequest,
    onEvent: (event: StreamEvent) => void,
  ): Promise<GenerateResult> {
    const stream = this.client.streamMessage(
      this.buildCommonParams(request, DEFAULT_STREAM_MAX_TOKENS, this.model),
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          onEvent({ type: "text_delta", text: event.delta.text });
        } else if (event.delta.type === "thinking_delta") {
          onEvent({ type: "thinking_delta", text: event.delta.thinking });
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    return {
      content: fromAnthropicContent(finalMessage.content),
      stopReason: fromAnthropicStopReason(finalMessage.stop_reason),
      usage: fromAnthropicUsage(finalMessage.usage),
    };
  }

  async toolCall(request: ToolCallRequest): Promise<GenerateResult> {
    const response = await this.client.createMessage({
      ...this.buildCommonParams(request, DEFAULT_MAX_TOKENS, this.model),
      tools: toAnthropicTools(request.tools),
      tool_choice: toAnthropicToolChoice(request.toolChoice),
    });
    return {
      content: fromAnthropicContent(response.content),
      stopReason: fromAnthropicStopReason(response.stop_reason),
      usage: fromAnthropicUsage(response.usage),
    };
  }

  async structuredOutput<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    const response = await this.client.parseMessage(
      this.buildCommonParams(request, DEFAULT_MAX_TOKENS, this.model),
      request.schema,
    );
    return {
      value: response.parsed_output,
      stopReason: fromAnthropicStopReason(response.stop_reason),
      usage: fromAnthropicUsage(response.usage),
    };
  }
}
