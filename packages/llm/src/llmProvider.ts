import type {
  GenerateRequest,
  GenerateResult,
  StreamEvent,
  StructuredOutputRequest,
  StructuredOutputResult,
  ToolCallRequest,
} from "./types.js";

export interface LLMProvider {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest, onEvent: (event: StreamEvent) => void): Promise<GenerateResult>;
  toolCall(request: ToolCallRequest): Promise<GenerateResult>;
  structuredOutput<T>(request: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>>;
}
