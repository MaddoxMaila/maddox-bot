import type { ToolDefinition } from "@maddox-bot/agent-tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toLLMToolDefinitions } from "./toolConversion.js";

describe("toLLMToolDefinitions", () => {
  it("converts a tool's Zod schema to a plain JSON Schema, without a $schema key", () => {
    const inputSchema = z.object({ path: z.string(), recursive: z.boolean().optional() });
    const tool: ToolDefinition<z.infer<typeof inputSchema>> = {
      name: "repo.list_files",
      description: "List files under a path.",
      inputSchema,
      async execute() {
        return { ok: true, output: [] };
      },
    };

    const [converted] = toLLMToolDefinitions([tool]);

    expect(converted).toEqual({
      name: "repo.list_files",
      description: "List files under a path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    });
  });

  it("converts a whole toolset in order", () => {
    const makeTool = (name: string): ToolDefinition => ({
      name,
      description: `does ${name}`,
      inputSchema: z.object({}),
      async execute() {
        return { ok: true, output: undefined };
      },
    });

    const converted = toLLMToolDefinitions([makeTool("a"), makeTool("b")]);

    expect(converted.map((tool) => tool.name)).toEqual(["a", "b"]);
  });
});
