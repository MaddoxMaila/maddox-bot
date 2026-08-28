import { describe, expect, it } from "vitest";
import { implementationPlanSchema } from "./implementationPlan.js";

describe("implementationPlanSchema", () => {
  it("accepts a well-formed plan, with openQuestions omitted", () => {
    const result = implementationPlanSchema.safeParse({
      summary: "Add a /health endpoint",
      approach: "Add a new route that returns 200 with a static payload",
      filesToModify: [{ path: "src/app.ts", reason: "register the new route" }],
      filesToCreate: [{ path: "src/routes/health.ts", reason: "the route handler" }],
      risks: [],
      requiredTests: ["GET /health returns 200"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a plan missing a required field", () => {
    const result = implementationPlanSchema.safeParse({
      summary: "Add a /health endpoint",
      filesToModify: [],
      filesToCreate: [],
      risks: [],
      requiredTests: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a file change with no reason", () => {
    const result = implementationPlanSchema.safeParse({
      summary: "x",
      approach: "y",
      filesToModify: [{ path: "src/app.ts" }],
      filesToCreate: [],
      risks: [],
      requiredTests: [],
    });

    expect(result.success).toBe(false);
  });
});
