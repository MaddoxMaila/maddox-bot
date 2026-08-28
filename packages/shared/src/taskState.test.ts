import { describe, expect, it } from "vitest";
import { isTaskState, TASK_STATES } from "./taskState.js";

describe("isTaskState", () => {
  it.each(TASK_STATES)("accepts %s as a valid task state", (state) => {
    expect(isTaskState(state)).toBe(true);
  });

  it("rejects a string that is not a known state", () => {
    expect(isTaskState("NOT_A_REAL_STATE")).toBe(false);
  });

  it("rejects a case-mismatched state", () => {
    expect(isTaskState("created")).toBe(false);
  });
});
