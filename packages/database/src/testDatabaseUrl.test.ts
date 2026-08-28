import { afterEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./testDatabaseUrl.js";

describe("testDatabaseUrl", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("falls back to the compose default when DATABASE_URL is unset", () => {
    delete process.env.DATABASE_URL;
    expect(testDatabaseUrl()).toBe("postgresql://maddox:maddox@localhost:5433/maddox_bot");
  });

  it("prefers an explicit DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://someone:else@somewhere:5432/other";
    expect(testDatabaseUrl()).toBe("postgresql://someone:else@somewhere:5432/other");
  });
});
