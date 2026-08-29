import { describe, expect, it } from "vitest";
import { parseCommand } from "./commandParser.js";

describe("parseCommand", () => {
  it("parses 'implement <ISSUE-KEY>' case-insensitively and uppercases the key", () => {
    expect(parseCommand("implement proj-42")).toEqual({ type: "implement", issueKey: "PROJ-42" });
    expect(parseCommand("Implement PROJ-42")).toEqual({ type: "implement", issueKey: "PROJ-42" });
  });

  it("requires a real issue-key shape after 'implement'", () => {
    expect(parseCommand("implement")).toEqual({ type: "unknown", raw: "implement" });
    expect(parseCommand("implement something")).toEqual({
      type: "unknown",
      raw: "implement something",
    });
  });

  it("parses cancel/pause/resume/continue", () => {
    expect(parseCommand("cancel")).toEqual({ type: "cancel" });
    expect(parseCommand("pause")).toEqual({ type: "pause" });
    expect(parseCommand("resume")).toEqual({ type: "resume" });
    expect(parseCommand("continue")).toEqual({ type: "resume" });
  });

  it("parses status and diff, with or without a 'show' prefix", () => {
    expect(parseCommand("status")).toEqual({ type: "status" });
    expect(parseCommand("show status")).toEqual({ type: "status" });
    expect(parseCommand("diff")).toEqual({ type: "diff" });
    expect(parseCommand("show diff")).toEqual({ type: "diff" });
  });

  it("parses help", () => {
    expect(parseCommand("help")).toEqual({ type: "help" });
  });

  it("is case-insensitive and trims whitespace for fixed keywords", () => {
    expect(parseCommand("  CANCEL  ")).toEqual({ type: "cancel" });
    expect(parseCommand("Status")).toEqual({ type: "status" });
  });

  it("falls back to unknown for anything else, preserving the trimmed original text", () => {
    expect(parseCommand("  what's up  ")).toEqual({ type: "unknown", raw: "what's up" });
  });
});
