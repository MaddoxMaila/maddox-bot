import { describe, expect, it } from "vitest";
import { computeDedupeKey } from "./dedupeKey.js";

describe("computeDedupeKey", () => {
  it("is deterministic for the same source and event id", () => {
    expect(computeDedupeKey("github", "delivery-1")).toBe(computeDedupeKey("github", "delivery-1"));
  });

  it("differs between sources for the same event id", () => {
    expect(computeDedupeKey("github", "id-1")).not.toBe(computeDedupeKey("jira", "id-1"));
  });

  it("differs between event ids for the same source", () => {
    expect(computeDedupeKey("github", "id-1")).not.toBe(computeDedupeKey("github", "id-2"));
  });
});
