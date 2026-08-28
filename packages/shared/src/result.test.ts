import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type Result } from "./result.js";

describe("Result helpers", () => {
  it("ok() produces a success result narrowed by isOk()", () => {
    const result: Result<number> = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("err() produces a failure result narrowed by isErr()", () => {
    const result: Result<number, string> = err("boom");
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBe("boom");
    }
  });
});
