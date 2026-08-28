import { createAnthropicAdapter } from "./anthropicAdapter.js";
import { AnthropicProvider, DEFAULT_MODEL } from "./anthropicProvider.js";

export function createAnthropicProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): AnthropicProvider {
  return new AnthropicProvider(createAnthropicAdapter(apiKey), model);
}
