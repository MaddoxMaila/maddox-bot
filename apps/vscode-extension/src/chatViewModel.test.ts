import { describe, expect, it, vi } from "vitest";
import type { MaddoxApiClient, TaskDto } from "./apiClient.js";
import { MaddoxApiError } from "./apiClient.js";
import { createChatState, submitChatInput } from "./chatViewModel.js";

const NO_WAIT = { attempts: 3, delayMs: 0, sleep: async () => {} };

function fakeApi(overrides: Partial<MaddoxApiClient> = {}): MaddoxApiClient {
  return {
    listTasks: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(null),
    getTaskByReceivedEvent: vi.fn().mockResolvedValue(null),
    listTaskEvents: vi.fn().mockResolvedValue([]),
    implementIssue: vi.fn().mockResolvedValue({ receivedEventId: "evt-1" }),
    cancelTask: vi.fn().mockResolvedValue({ id: "task-1", state: "CANCELLED" }),
    getPullRequest: vi.fn().mockResolvedValue(null),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    decideApproval: vi.fn().mockResolvedValue({ id: "appr-1", status: "approved" }),
    ...overrides,
  };
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    repositoryId: "repo-1",
    state: "CREATED",
    jiraIssueId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("submitChatInput", () => {
  it("echoes the user's input as a chat message before acting on it", async () => {
    const state = await submitChatInput(createChatState("repo-1"), "help", fakeApi(), NO_WAIT);
    expect(state.messages[0]).toMatchObject({ role: "user", text: "help" });
  });

  describe("implement <ISSUE-KEY>", () => {
    it("enqueues the issue, polls until the task appears, and sets it as current", async () => {
      const api = fakeApi({
        getTaskByReceivedEvent: vi.fn().mockResolvedValue(task({ state: "CREATED" })),
      });

      const state = await submitChatInput(
        createChatState("repo-1"),
        "implement PROJ-1",
        api,
        NO_WAIT,
      );

      expect(api.implementIssue).toHaveBeenCalledWith("repo-1", "PROJ-1");
      expect(state.currentTaskId).toBe("task-1");
      expect(state.messages.at(-1)?.text).toContain("CREATED");
    });

    it("tells the user to check the dashboard if the task never appears within the poll budget", async () => {
      const api = fakeApi(); // getTaskByReceivedEvent resolves null every time

      const state = await submitChatInput(
        createChatState("repo-1"),
        "implement PROJ-1",
        api,
        NO_WAIT,
      );

      expect(state.currentTaskId).toBeNull();
      expect(state.messages.at(-1)?.text).toMatch(/check the dashboard/i);
      expect(api.getTaskByReceivedEvent).toHaveBeenCalledTimes(NO_WAIT.attempts);
    });
  });

  describe("status", () => {
    it("reports there's no active task when none has been set yet", async () => {
      const state = await submitChatInput(createChatState("repo-1"), "status", fakeApi(), NO_WAIT);
      expect(state.messages.at(-1)?.text).toMatch(/no active task/i);
    });

    it("reports the current task's state", async () => {
      const api = fakeApi({ getTask: vi.fn().mockResolvedValue(task({ state: "IMPLEMENTING" })) });
      let state = createChatState("repo-1");
      state = { ...state, currentTaskId: "task-1" };

      state = await submitChatInput(state, "status", api, NO_WAIT);

      expect(state.messages.at(-1)?.text).toContain("IMPLEMENTING");
    });
  });

  describe("diff", () => {
    it("reports no pull request yet when there isn't one", async () => {
      let state = createChatState("repo-1");
      state = { ...state, currentTaskId: "task-1" };

      state = await submitChatInput(state, "diff", fakeApi(), NO_WAIT);

      expect(state.messages.at(-1)?.text).toMatch(/no pull request yet/i);
    });

    it("reports the pull request URL once one exists", async () => {
      const api = fakeApi({
        getPullRequest: vi.fn().mockResolvedValue({
          id: "pr-1",
          url: "https://github.com/acme/sample/pull/1",
          title: "t",
          status: "open",
          providerPrNumber: 1,
        }),
      });
      let state = createChatState("repo-1");
      state = { ...state, currentTaskId: "task-1" };

      state = await submitChatInput(state, "diff", api, NO_WAIT);

      expect(state.messages.at(-1)?.text).toContain("https://github.com/acme/sample/pull/1");
    });
  });

  describe("cancel", () => {
    it("cancels the current task", async () => {
      const api = fakeApi();
      let state = createChatState("repo-1");
      state = { ...state, currentTaskId: "task-1" };

      state = await submitChatInput(state, "cancel", api, NO_WAIT);

      expect(api.cancelTask).toHaveBeenCalledWith("task-1");
      expect(state.messages.at(-1)?.text).toMatch(/cancelled/i);
    });

    it("surfaces a cancel failure (e.g. already terminal) without throwing", async () => {
      const api = fakeApi({
        cancelTask: vi.fn().mockRejectedValue(new MaddoxApiError(409, "task is already terminal")),
      });
      let state = createChatState("repo-1");
      state = { ...state, currentTaskId: "task-1" };

      state = await submitChatInput(state, "cancel", api, NO_WAIT);

      expect(state.messages.at(-1)?.text).toContain("task is already terminal");
    });

    it("reports there's no active task to cancel when none is set", async () => {
      const state = await submitChatInput(createChatState("repo-1"), "cancel", fakeApi(), NO_WAIT);
      expect(state.messages.at(-1)?.text).toMatch(/no active task/i);
    });
  });

  describe("pause/resume", () => {
    it("tells the user these aren't supported yet, without calling the API", async () => {
      const api = fakeApi();
      let state = await submitChatInput(createChatState("repo-1"), "pause", api, NO_WAIT);
      expect(state.messages.at(-1)?.text).toMatch(/aren't supported yet/i);
      state = await submitChatInput(state, "resume", api, NO_WAIT);
      expect(state.messages.at(-1)?.text).toMatch(/aren't supported yet/i);
    });
  });

  describe("help and unknown", () => {
    it("lists the available commands for 'help'", async () => {
      const state = await submitChatInput(createChatState("repo-1"), "help", fakeApi(), NO_WAIT);
      expect(state.messages.at(-1)?.text).toContain("implement <ISSUE-KEY>");
    });

    it("responds to unrecognized input with guidance instead of silently ignoring it", async () => {
      const state = await submitChatInput(
        createChatState("repo-1"),
        "do a barrel roll",
        fakeApi(),
        NO_WAIT,
      );
      expect(state.messages.at(-1)?.text).toMatch(/not sure how to do that/i);
    });
  });
});
