import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJiraApiAdapter } from "./jiraApiAdapter.js";

const CREDENTIALS = {
  baseUrl: "https://example.atlassian.net/",
  email: "bot@example.com",
  apiToken: "test-token",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

describe("createJiraApiAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getIssue requests the issue endpoint with Basic auth and strips a trailing slash from baseUrl", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ key: "PROJ-481" }));
    const adapter = createJiraApiAdapter(CREDENTIALS);

    const result = await adapter.getIssue("PROJ-481");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-481",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("bot@example.com:test-token").toString("base64")}`,
        }),
      }),
    );
    expect(result).toEqual({ key: "PROJ-481" });
  });

  it("getComments requests the comment endpoint and unwraps the comments array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ comments: [{ id: "1" }] }));
    const adapter = createJiraApiAdapter(CREDENTIALS);

    const result = await adapter.getComments("PROJ-481");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-481/comment",
      expect.anything(),
    );
    expect(result).toEqual([{ id: "1" }]);
  });

  it("URL-encodes the issue key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ key: "PROJ 481" }));
    const adapter = createJiraApiAdapter(CREDENTIALS);

    await adapter.getIssue("PROJ 481");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ%20481",
      expect.anything(),
    );
  });

  it("throws a descriptive error on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 404));
    const adapter = createJiraApiAdapter(CREDENTIALS);

    await expect(adapter.getIssue("MISSING-1")).rejects.toThrow(/404/);
  });

  it("addComment POSTs the ADF body wrapped in a { body } envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "1" }));
    const adapter = createJiraApiAdapter(CREDENTIALS);
    const adf = { type: "doc", version: 1, content: [] };

    await adapter.addComment("PROJ-481", adf);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-481/comment",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ body: adf }),
      }),
    );
  });

  it("getTransitions requests the transitions endpoint and unwraps the array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ transitions: [{ id: "21", name: "Done", to: { name: "In Review" } }] }),
    );
    const adapter = createJiraApiAdapter(CREDENTIALS);

    const result = await adapter.getTransitions("PROJ-481");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-481/transitions",
      expect.anything(),
    );
    expect(result).toEqual([{ id: "21", name: "Done", to: { name: "In Review" } }]);
  });

  it("postTransition POSTs the transition id and tolerates a 204 No Content response", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: "No Content" });
    const adapter = createJiraApiAdapter(CREDENTIALS);

    await adapter.postTransition("PROJ-481", "21");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-481/transitions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ transition: { id: "21" } }),
      }),
    );
  });
});
