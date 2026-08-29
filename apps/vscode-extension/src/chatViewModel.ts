import type { MaddoxApiClient, TaskDto } from "./apiClient.js";
import { MaddoxApiError } from "./apiClient.js";
import { parseCommand, type ChatCommand } from "./commandParser.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ChatState {
  repositoryId: string;
  messages: ChatMessage[];
  currentTaskId: string | null;
}

export function createChatState(repositoryId: string): ChatState {
  return { repositoryId, messages: [], currentTaskId: null };
}

const HELP_TEXT =
  "Commands: `implement <ISSUE-KEY>`, `status`, `diff`, `cancel`, `pause`, `resume`, `help`.";

interface PollOptions {
  attempts: number;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_OPTIONS: PollOptions = {
  attempts: 5,
  delayMs: 500,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * POST /tasks enqueues a job but can't return a task id directly — the worker creates the
 * AgentTask asynchronously. This polls apps/api's by-received-event lookup a bounded number of
 * times rather than waiting indefinitely; a caller can override attempts/delayMs/sleep so tests
 * don't need real wall-clock waits.
 */
async function pollForTask(
  api: MaddoxApiClient,
  receivedEventId: string,
  options: PollOptions,
): Promise<TaskDto | null> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const task = await api.getTaskByReceivedEvent(receivedEventId);
    if (task) {
      return task;
    }
    await options.sleep(options.delayMs);
  }
  return null;
}

function say(state: ChatState, role: ChatMessage["role"], text: string): ChatState {
  const message: ChatMessage = { id: crypto.randomUUID(), role, text };
  return { ...state, messages: [...state.messages, message] };
}

function errorMessage(error: unknown): string {
  return error instanceof MaddoxApiError || error instanceof Error ? error.message : String(error);
}

async function runCommand(
  state: ChatState,
  command: ChatCommand,
  api: MaddoxApiClient,
  pollOptions: PollOptions,
): Promise<ChatState> {
  switch (command.type) {
    case "implement": {
      const started = say(state, "assistant", `Starting implementation of ${command.issueKey}...`);
      const { receivedEventId } = await api.implementIssue(state.repositoryId, command.issueKey);
      const task = await pollForTask(api, receivedEventId, pollOptions);
      if (task) {
        return say(
          { ...started, currentTaskId: task.id },
          "assistant",
          `Task created (${task.id}), state: ${task.state}.`,
        );
      }
      return say(
        started,
        "assistant",
        "Still waiting for the task to be created — check the dashboard shortly.",
      );
    }

    case "status": {
      if (!state.currentTaskId) {
        return say(state, "assistant", "No active task. Try `implement <ISSUE-KEY>` first.");
      }
      const task = await api.getTask(state.currentTaskId);
      return say(
        state,
        "assistant",
        task ? `Task ${task.id} is ${task.state}.` : "That task no longer exists.",
      );
    }

    case "diff": {
      if (!state.currentTaskId) {
        return say(state, "assistant", "No active task. Try `implement <ISSUE-KEY>` first.");
      }
      const pullRequest = await api.getPullRequest(state.currentTaskId);
      return say(
        state,
        "assistant",
        pullRequest ? `Pull request: ${pullRequest.url}` : "No pull request yet for this task.",
      );
    }

    case "cancel": {
      if (!state.currentTaskId) {
        return say(state, "assistant", "No active task to cancel.");
      }
      const task = await api.cancelTask(state.currentTaskId);
      return say(state, "assistant", `Task ${task.id} cancelled.`);
    }

    case "pause":
    case "resume":
      return say(
        state,
        "assistant",
        "Pause/resume aren't supported yet in Phase 1 — see this extension's README.",
      );

    case "help":
      return say(state, "assistant", HELP_TEXT);

    case "unknown":
      return say(state, "assistant", `Not sure how to do that. ${HELP_TEXT}`);
  }
}

export async function submitChatInput(
  state: ChatState,
  input: string,
  api: MaddoxApiClient,
  pollOptions: PollOptions = DEFAULT_POLL_OPTIONS,
): Promise<ChatState> {
  const withUserMessage = say(state, "user", input);
  const command = parseCommand(input);

  try {
    return await runCommand(withUserMessage, command, api, pollOptions);
  } catch (error) {
    return say(withUserMessage, "assistant", `Something went wrong: ${errorMessage(error)}`);
  }
}
