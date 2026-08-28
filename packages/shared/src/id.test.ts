import { describe, expect, it } from "vitest";
import { createId } from "./id.js";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createId", () => {
  it("returns a well-formed UUID v4", () => {
    expect(createId()).toMatch(UUID_V4_PATTERN);
  });

  it("returns a different value on each call", () => {
    expect(createId()).not.toBe(createId());
  });
});
