import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./client.js";
import { testDatabaseUrl } from "./testDatabaseUrl.js";

// Deliberately not `toBeInstanceOf(PrismaClient)` / deep-equality here: PrismaClient instances
// are built from Proxies for the fluent `.model.method()` API, and generic matcher introspection
// (or a failed-match diff) can recurse into those proxies until the call stack overflows. Assert
// on a concrete, safe capability instead.
describe("createPrismaClient", () => {
  it("returns a client exposing the expected lifecycle methods when no URL override is given", () => {
    const client = createPrismaClient();
    expect(typeof client.$connect).toBe("function");
    expect(typeof client.$disconnect).toBe("function");
  });

  it("accepts an explicit database URL override without throwing", () => {
    expect(() => createPrismaClient(testDatabaseUrl())).not.toThrow();
  });
});
