import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "./anthropicProvider.js";
import { ModelRouter } from "./modelRouter.js";

describe("ModelRouter", () => {
  it("defaults every concern to claude-opus-5 with no config", () => {
    const router = new ModelRouter();
    expect(router.modelFor("planning")).toBe(DEFAULT_MODEL);
    expect(router.modelFor("implementation")).toBe(DEFAULT_MODEL);
    expect(router.modelFor("codeReview")).toBe(DEFAULT_MODEL);
    expect(router.modelFor("summarization")).toBe(DEFAULT_MODEL);
    expect(router.modelFor("classification")).toBe(DEFAULT_MODEL);
  });

  it("respects a custom default model", () => {
    const router = new ModelRouter({ defaultModel: "claude-sonnet-5" });
    expect(router.modelFor("planning")).toBe("claude-sonnet-5");
  });

  it("overrides a specific concern without affecting others", () => {
    const router = new ModelRouter({ overrides: { classification: "claude-haiku-4-5" } });
    expect(router.modelFor("classification")).toBe("claude-haiku-4-5");
    expect(router.modelFor("planning")).toBe(DEFAULT_MODEL);
  });
});
