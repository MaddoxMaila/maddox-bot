import type { HostToWebviewMessage, WebviewToHostMessage } from "../protocol.js";

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void };

const vscode = acquireVsCodeApi();

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`webview HTML is missing #${id}`);
  }
  return element as T;
}

const taskListEl = requireElement<HTMLUListElement>("task-list");
const approvalListEl = requireElement<HTMLUListElement>("approval-list");
const eventListEl = requireElement<HTMLUListElement>("event-list");
const chatLogEl = requireElement<HTMLUListElement>("chat-log");
const chatFormEl = requireElement<HTMLFormElement>("chat-form");
const chatInputEl = requireElement<HTMLInputElement>("chat-input");

function clear(el: HTMLElement): void {
  el.replaceChildren();
}

function render(message: HostToWebviewMessage): void {
  clear(taskListEl);
  for (const task of message.dashboard.tasks) {
    const li = document.createElement("li");
    li.className = task.id === message.dashboard.selectedTaskId ? "task-row selected" : "task-row";
    li.textContent = `${task.id} — ${task.state}`;
    li.addEventListener("click", () => {
      vscode.postMessage({ type: "selectTask", taskId: task.id });
    });
    taskListEl.appendChild(li);
  }

  clear(approvalListEl);
  for (const approval of message.dashboard.pendingApprovals) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${approval.summary} `;
    li.appendChild(label);

    const approveButton = document.createElement("button");
    approveButton.textContent = "Approve";
    approveButton.addEventListener("click", () => {
      vscode.postMessage({ type: "decideApproval", approvalId: approval.id, decision: "approved" });
    });
    li.appendChild(approveButton);

    const denyButton = document.createElement("button");
    denyButton.textContent = "Deny";
    denyButton.addEventListener("click", () => {
      vscode.postMessage({ type: "decideApproval", approvalId: approval.id, decision: "denied" });
    });
    li.appendChild(denyButton);

    approvalListEl.appendChild(li);
  }

  clear(eventListEl);
  for (const event of message.dashboard.selectedTaskEvents) {
    const li = document.createElement("li");
    li.textContent = `${event.createdAt} — ${event.type}`;
    eventListEl.appendChild(li);
  }

  clear(chatLogEl);
  for (const chatMessage of message.chat.messages) {
    const li = document.createElement("li");
    li.className = `role-${chatMessage.role}`;
    li.textContent = chatMessage.text;
    chatLogEl.appendChild(li);
  }
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

chatFormEl.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  const text = chatInputEl.value.trim();
  if (text.length === 0) {
    return;
  }
  vscode.postMessage({ type: "chatSubmit", text });
  chatInputEl.value = "";
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "render") {
    render(data as HostToWebviewMessage);
  }
});

vscode.postMessage({ type: "ready" });
