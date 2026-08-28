import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { ZodType } from "zod";

/**
 * The minimal surface AnthropicProvider depends on — mirrors packages/github's OctokitLike and
 * packages/jira's JiraApiLike: unit tests pass a plain object of functions instead of mocking the
 * real SDK client, which is awkward to construct in isolation (it validates its API key eagerly).
 */
export interface AnthropicClientLike {
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  streamMessage(params: Anthropic.MessageStreamParams): MessageStream;
  parseMessage<T>(
    params: Anthropic.MessageCreateParamsNonStreaming,
    schema: ZodType<T>,
  ): Promise<{ parsed_output: T | null; stop_reason: string | null; usage: Anthropic.Usage }>;
}
