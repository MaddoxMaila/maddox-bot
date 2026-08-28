import { DEFAULT_MODEL } from "./anthropicProvider.js";

export type Concern =
  "planning" | "implementation" | "codeReview" | "summarization" | "classification";

export interface ModelRouterConfig {
  defaultModel?: string;
  overrides?: Partial<Record<Concern, string>>;
}

/**
 * Every concern defaults to the same model — moving one concern to a cheaper model later is a
 * config change here, not an architecture change (never downgrade for cost on your own judgement;
 * that's the user's call). See ADR-0001.
 */
export class ModelRouter {
  private readonly defaultModel: string;
  private readonly overrides: Partial<Record<Concern, string>>;

  constructor(config: ModelRouterConfig = {}) {
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.overrides = config.overrides ?? {};
  }

  modelFor(concern: Concern): string {
    return this.overrides[concern] ?? this.defaultModel;
  }
}
