import { describe, expect, it, vi } from "vitest";
import type { JiraApiLike } from "./jiraApiLike.js";
import { JiraClient } from "./jiraClient.js";

function fakeApi(overrides: Partial<JiraApiLike> = {}): JiraApiLike {
  return {
    getIssue: vi.fn(),
    getComments: vi.fn(),
    addComment: vi.fn(),
    getTransitions: vi.fn(),
    postTransition: vi.fn(),
    ...overrides,
  };
}

const textAdf = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("JiraClient", () => {
  it("getIssue maps the raw shape, rendering the ADF description to plain text", async () => {
    const api = fakeApi({
      getIssue: vi.fn().mockResolvedValue({
        key: "PROJ-481",
        fields: {
          summary: "Add password reset functionality",
          description: textAdf("Users can reset their password."),
          status: { name: "AI READY" },
          assignee: { displayName: "Jane Doe" },
          labels: ["ai-agent"],
        },
      }),
    });
    const client = new JiraClient(api);

    const issue = await client.getIssue("PROJ-481");

    expect(issue).toEqual({
      key: "PROJ-481",
      summary: "Add password reset functionality",
      description: "Users can reset their password.",
      status: "AI READY",
      assignee: "Jane Doe",
      labels: ["ai-agent"],
    });
    expect(api.getIssue).toHaveBeenCalledWith("PROJ-481");
  });

  it("getIssue defaults a missing assignee to null", async () => {
    const api = fakeApi({
      getIssue: vi.fn().mockResolvedValue({
        key: "PROJ-482",
        fields: {
          summary: "Unassigned ticket",
          description: null,
          status: { name: "BACKLOG" },
          assignee: null,
          labels: [],
        },
      }),
    });
    const client = new JiraClient(api);

    const issue = await client.getIssue("PROJ-482");

    expect(issue.assignee).toBeNull();
    expect(issue.description).toBe("");
  });

  it("getComments maps each raw comment, rendering the ADF body to plain text", async () => {
    const api = fakeApi({
      getComments: vi.fn().mockResolvedValue([
        {
          id: "10001",
          author: { displayName: "Reviewer One" },
          body: textAdf("Looks good to me."),
          created: "2026-01-01T00:00:00.000Z",
        },
      ]),
    });
    const client = new JiraClient(api);

    const comments = await client.getComments("PROJ-481");

    expect(comments).toEqual([
      {
        id: "10001",
        author: "Reviewer One",
        body: "Looks good to me.",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(api.getComments).toHaveBeenCalledWith("PROJ-481");
  });

  it("addComment converts plain text to ADF before sending", async () => {
    const api = fakeApi();
    const client = new JiraClient(api);

    await client.addComment("PROJ-481", "Started work on this.");

    expect(api.addComment).toHaveBeenCalledWith("PROJ-481", {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Started work on this." }] }],
    });
  });

  it("transitionIssue looks up the transition id for the target status and submits it", async () => {
    const api = fakeApi({
      getTransitions: vi.fn().mockResolvedValue([
        { id: "11", name: "Start Progress", to: { name: "In Progress" } },
        { id: "21", name: "Done", to: { name: "In Review" } },
      ]),
    });
    const client = new JiraClient(api);

    await client.transitionIssue("PROJ-481", "In Review");

    expect(api.postTransition).toHaveBeenCalledWith("PROJ-481", "21");
  });

  it("transitionIssue matches the target status case-insensitively", async () => {
    const api = fakeApi({
      getTransitions: vi
        .fn()
        .mockResolvedValue([{ id: "11", name: "Start Progress", to: { name: "In Progress" } }]),
    });
    const client = new JiraClient(api);

    await client.transitionIssue("PROJ-481", "in progress");

    expect(api.postTransition).toHaveBeenCalledWith("PROJ-481", "11");
  });

  it("transitionIssue throws a descriptive error when no matching transition is available", async () => {
    const api = fakeApi({
      getTransitions: vi
        .fn()
        .mockResolvedValue([{ id: "11", name: "Start Progress", to: { name: "In Progress" } }]),
    });
    const client = new JiraClient(api);

    await expect(client.transitionIssue("PROJ-481", "Done")).rejects.toThrow(
      /No transition to "Done".*available: In Progress/,
    );
    expect(api.postTransition).not.toHaveBeenCalled();
  });

  it("linkPullRequest posts a comment with a real ADF link mark, not markdown", async () => {
    const api = fakeApi();
    const client = new JiraClient(api);

    await client.linkPullRequest("PROJ-481", {
      url: "https://github.com/acme/widgets/pull/7",
      title: "Add password reset functionality",
    });

    expect(api.addComment).toHaveBeenCalledWith("PROJ-481", {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Pull request opened: " },
            {
              type: "text",
              text: "Add password reset functionality",
              marks: [{ type: "link", attrs: { href: "https://github.com/acme/widgets/pull/7" } }],
            },
          ],
        },
      ],
    });
  });
});
