import { describe, expect, it } from "vitest";
import { parseJiraTriggerConfig } from "./parseJiraTriggerConfig.js";

describe("parseJiraTriggerConfig", () => {
  it("returns an empty config for null, non-object, or empty input", () => {
    expect(parseJiraTriggerConfig(null)).toEqual({});
    expect(parseJiraTriggerConfig("not an object")).toEqual({});
    expect(parseJiraTriggerConfig({})).toEqual({});
  });

  it("extracts recognized string fields", () => {
    expect(
      parseJiraTriggerConfig({
        triggerStatus: "READY FOR BOT",
        triggerLabel: "bot-ready",
        aiAssigneeAccountId: "account-1",
      }),
    ).toEqual({
      triggerStatus: "READY FOR BOT",
      triggerLabel: "bot-ready",
      aiAssigneeAccountId: "account-1",
    });
  });

  it("ignores unrecognized or wrongly-typed fields", () => {
    expect(parseJiraTriggerConfig({ triggerStatus: 123, somethingElse: "ignored" })).toEqual({});
  });

  it("extracts a partial config", () => {
    expect(parseJiraTriggerConfig({ triggerLabel: "ai-agent" })).toEqual({
      triggerLabel: "ai-agent",
    });
  });
});
