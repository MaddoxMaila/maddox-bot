import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("shared package scaffold", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@maddox-bot/shared");
  });
});
