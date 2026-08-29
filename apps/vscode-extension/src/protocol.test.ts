import { describe, expect, it } from "vitest";
import { isWebviewToHostMessage } from "./protocol.js";

describe("isWebviewToHostMessage", () => {
  it("accepts a 'ready' message", () => {
    expect(isWebviewToHostMessage({ type: "ready" })).toBe(true);
  });

  it("accepts a well-formed chatSubmit message", () => {
    expect(isWebviewToHostMessage({ type: "chatSubmit", text: "implement PROJ-1" })).toBe(true);
  });

  it("accepts a well-formed selectTask message", () => {
    expect(isWebviewToHostMessage({ type: "selectTask", taskId: "task-1" })).toBe(true);
  });

  it("accepts a well-formed decideApproval message with a valid decision", () => {
    expect(
      isWebviewToHostMessage({ type: "decideApproval", approvalId: "a1", decision: "approved" }),
    ).toBe(true);
    expect(
      isWebviewToHostMessage({ type: "decideApproval", approvalId: "a1", decision: "denied" }),
    ).toBe(true);
  });

  it("rejects a decideApproval message with an invalid decision", () => {
    expect(
      isWebviewToHostMessage({ type: "decideApproval", approvalId: "a1", decision: "maybe" }),
    ).toBe(false);
  });

  it("rejects messages missing required fields", () => {
    expect(isWebviewToHostMessage({ type: "chatSubmit" })).toBe(false);
    expect(isWebviewToHostMessage({ type: "selectTask" })).toBe(false);
  });

  it("rejects an unknown type, non-objects, and null", () => {
    expect(isWebviewToHostMessage({ type: "somethingElse" })).toBe(false);
    expect(isWebviewToHostMessage("not an object")).toBe(false);
    expect(isWebviewToHostMessage(null)).toBe(false);
    expect(isWebviewToHostMessage(undefined)).toBe(false);
  });
});
