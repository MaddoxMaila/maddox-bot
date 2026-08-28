import { afterEach, describe, expect, it } from "vitest";
import { testRedisUrl } from "./testRedisUrl.js";

describe("testRedisUrl", () => {
  const original = process.env.REDIS_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = original;
    }
  });

  it("falls back to the compose default when REDIS_URL is unset", () => {
    delete process.env.REDIS_URL;
    expect(testRedisUrl()).toBe("redis://localhost:6380");
  });

  it("prefers an explicit REDIS_URL", () => {
    process.env.REDIS_URL = "redis://somewhere:6379";
    expect(testRedisUrl()).toBe("redis://somewhere:6379");
  });
});
