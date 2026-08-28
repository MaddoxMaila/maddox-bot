import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import type { AnthropicClientLike } from "./anthropicClientLike.js";

export function createAnthropicAdapter(apiKey: string): AnthropicClientLike {
  const client = new Anthropic({ apiKey });
  return {
    createMessage(params) {
      return client.messages.create(params);
    },
    streamMessage(params) {
      return client.messages.stream(params);
    },
    async parseMessage<T>(params: Anthropic.MessageCreateParamsNonStreaming, schema: ZodType<T>) {
      const response = await client.messages.parse({
        ...params,
        output_config: { format: zodOutputFormat(schema) },
      });
      return {
        // The SDK's own return type for parsed_output is `unknown` here; the schema we just
        // passed it is what actually guarantees the shape at runtime.
        parsed_output: response.parsed_output as T | null,
        stop_reason: response.stop_reason,
        usage: response.usage,
      };
    },
  };
}
