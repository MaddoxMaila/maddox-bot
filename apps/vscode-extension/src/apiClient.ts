/**
 * Wire-shape DTOs matching apps/api's JSON responses (dates as ISO strings, not Date objects) —
 * defined locally rather than imported from @maddox-bot/database, since this extension runs in a
 * separate process (VS Code's own) and only ever talks to the server over HTTP, the same way any
 * other REST client would.
 */
export interface TaskDto {
  id: string;
  repositoryId: string;
  state: string;
  jiraIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEventDto {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  taskId: string;
  kind: string;
  summary: string;
  status: string;
  createdAt: string;
}

export interface PullRequestDto {
  id: string;
  url: string;
  title: string;
  status: string;
  providerPrNumber: number;
}

export class MaddoxApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MaddoxApiError";
  }
}

/**
 * Narrow client-like interface (this repo's established pattern for wrapping external services —
 * see @maddox-bot/github's OctokitLike, @maddox-bot/jira's JiraApiLike) so chatViewModel and
 * dashboardViewModel can be unit tested against a fake, without a real HTTP round trip.
 */
export interface MaddoxApiClient {
  listTasks(repositoryId: string): Promise<TaskDto[]>;
  getTask(taskId: string): Promise<TaskDto | null>;
  getTaskByReceivedEvent(receivedEventId: string): Promise<TaskDto | null>;
  listTaskEvents(taskId: string): Promise<TaskEventDto[]>;
  implementIssue(repositoryId: string, issueKey: string): Promise<{ receivedEventId: string }>;
  cancelTask(taskId: string): Promise<TaskDto>;
  getPullRequest(taskId: string): Promise<PullRequestDto | null>;
  listPendingApprovals(): Promise<ApprovalDto[]>;
  decideApproval(approvalId: string, decision: "approved" | "denied"): Promise<ApprovalDto>;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : {};
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request to ${url} failed with status ${response.status}`;
    throw new MaddoxApiError(response.status, message);
  }
  return body;
}

export class FetchMaddoxApiClient implements MaddoxApiClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async listTasks(repositoryId: string): Promise<TaskDto[]> {
    const body = (await requestJson(
      this.url(`/tasks?repositoryId=${encodeURIComponent(repositoryId)}`),
    )) as { tasks: TaskDto[] };
    return body.tasks;
  }

  async getTask(taskId: string): Promise<TaskDto | null> {
    const body = (await requestJson(this.url(`/tasks/${encodeURIComponent(taskId)}`))) as {
      task: TaskDto;
    };
    return body.task;
  }

  async getTaskByReceivedEvent(receivedEventId: string): Promise<TaskDto | null> {
    const body = (await requestJson(
      this.url(`/tasks/by-received-event/${encodeURIComponent(receivedEventId)}`),
    )) as { task: TaskDto | null };
    return body.task;
  }

  async listTaskEvents(taskId: string): Promise<TaskEventDto[]> {
    const body = (await requestJson(this.url(`/tasks/${encodeURIComponent(taskId)}/events`))) as {
      events: TaskEventDto[];
    };
    return body.events;
  }

  async implementIssue(
    repositoryId: string,
    issueKey: string,
  ): Promise<{ receivedEventId: string }> {
    return (await requestJson(this.url("/tasks"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryId, issueKey }),
    })) as { receivedEventId: string };
  }

  async cancelTask(taskId: string): Promise<TaskDto> {
    const body = (await requestJson(this.url(`/tasks/${encodeURIComponent(taskId)}/cancel`), {
      method: "POST",
    })) as { task: TaskDto };
    return body.task;
  }

  async getPullRequest(taskId: string): Promise<PullRequestDto | null> {
    const body = (await requestJson(
      this.url(`/tasks/${encodeURIComponent(taskId)}/pull-request`),
    )) as { pullRequest: PullRequestDto | null };
    return body.pullRequest;
  }

  async listPendingApprovals(): Promise<ApprovalDto[]> {
    const body = (await requestJson(this.url("/approvals"))) as { approvals: ApprovalDto[] };
    return body.approvals;
  }

  async decideApproval(approvalId: string, decision: "approved" | "denied"): Promise<ApprovalDto> {
    const body = (await requestJson(
      this.url(`/approvals/${encodeURIComponent(approvalId)}/decide`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    )) as { approval: ApprovalDto };
    return body.approval;
  }
}
