import { describe, expect, it } from "vitest";
import { createJiraClient } from "./createJiraClient.js";
import { JiraClient } from "./jiraClient.js";

describe("createJiraClient", () => {
  it("returns a JiraClient wired to a fetch-based adapter", () => {
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "bot@example.com",
      apiToken: "test-token",
    });
    expect(client).toBeInstanceOf(JiraClient);
  });
});
