import { describe, expect, it } from "vitest";
import { buildAuthenticatedCloneUrl } from "./authenticatedCloneUrl.js";

describe("buildAuthenticatedCloneUrl", () => {
  it("returns the URL unchanged when no token is given", () => {
    expect(buildAuthenticatedCloneUrl("https://github.com/octocat/hello-world.git")).toBe(
      "https://github.com/octocat/hello-world.git",
    );
  });

  it("injects the token as the password with a fixed username", () => {
    expect(
      buildAuthenticatedCloneUrl("https://github.com/octocat/hello-world.git", "ghp_secret"),
    ).toBe("https://x-access-token:ghp_secret@github.com/octocat/hello-world.git");
  });

  it("preserves the path and any existing query string", () => {
    expect(
      buildAuthenticatedCloneUrl("https://github.com/octocat/hello-world.git?ref=main", "tok"),
    ).toBe("https://x-access-token:tok@github.com/octocat/hello-world.git?ref=main");
  });
});
