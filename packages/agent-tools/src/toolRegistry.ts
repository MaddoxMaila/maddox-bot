import { PermissionGate } from "@maddox-bot/permissions";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "./toolDefinition.js";

/**
 * The one place spec §20's permission tiers become enforced behavior (see @maddox-bot/permissions'
 * README) — every call is validated against the tool's own Zod schema, classified, gated on
 * approval where required, and never even attempted when human_only.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly permissionGate: PermissionGate = new PermissionGate()) {}

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, rawInput: unknown, ctx: ToolExecutionContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const finish = (outcome: ToolResult): ToolResult => ({
      ...outcome,
      durationMs: Date.now() - startedAt,
    });

    const tool = this.tools.get(name);
    if (!tool) {
      return finish({
        ok: false,
        error: { code: "unknown_tool", message: `No tool registered: ${name}` },
        durationMs: 0,
      });
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return finish({
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
        durationMs: 0,
      });
    }

    const decision = this.permissionGate.classify({ toolName: name, input: parsed.data });
    const permission = { tier: decision.tier, reason: decision.reason };
    if (decision.tier === "human_only") {
      return finish({
        ok: false,
        error: {
          code: "human_only",
          message: `"${name}" requires direct human action (${decision.reason})`,
        },
        durationMs: 0,
        permission,
      });
    }
    if (decision.tier === "approval_required") {
      const approval = await ctx.requestApproval(
        `"${name}" requires approval (${decision.reason})`,
      );
      if (approval === "denied") {
        return finish({
          ok: false,
          error: {
            code: "approval_denied",
            message: `"${name}" was denied approval (${decision.reason})`,
          },
          durationMs: 0,
          permission,
        });
      }
    }

    try {
      const outcome = await tool.execute(parsed.data, ctx);
      return finish({ ...outcome, durationMs: 0, permission });
    } catch (error) {
      return finish({
        ok: false,
        error: {
          code: "execution_error",
          message: error instanceof Error ? error.message : String(error),
        },
        durationMs: 0,
        permission,
      });
    }
  }
}
