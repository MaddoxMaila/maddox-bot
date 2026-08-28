import { afterEach, describe, expect, it } from "vitest";
import { requireEnv } from "./env.js";

describe("requireEnv", () => {
  const key = "MADDOX_BOT_TEST_ENV_VAR";

  afterEach(() => {
    delete process.env[key];
  });

  it("returns the value when set", () => {
    process.env[key] = "a-value";
    expect(requireEnv(key)).toBe("a-value");
  });

  it("throws a descriptive error when unset", () => {
    delete process.env[key];
    expect(() => requireEnv(key)).toThrow(/MADDOX_BOT_TEST_ENV_VAR/);
  });

  it("throws for an empty string", () => {
    process.env[key] = "";
    expect(() => requireEnv(key)).toThrow();
  });
});
