import * as vscode from "vscode";
import { FetchMaddoxApiClient, type MaddoxApiClient } from "./apiClient.js";
import { createChatState, submitChatInput, type ChatState } from "./chatViewModel.js";
import { readConfig } from "./config.js";
import {
  applyPendingApprovals,
  applyStreamUpdate,
  applyTaskList,
  createDashboardState,
  selectTask,
  type DashboardState,
} from "./dashboardViewModel.js";
import { isWebviewToHostMessage, type HostToWebviewMessage } from "./protocol.js";
import { connectTaskStream } from "./taskSocket.js";
import { getWebviewHtml } from "./webview/getHtml.js";
import type WebSocket from "ws";

const REFRESH_INTERVAL_MS = 5000;

/** A CSP nonce must be unpredictable — crypto.randomUUID() (not Math.random()) is what makes it
 * actually block a script an attacker managed to inject elsewhere in the page. */
function nonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Owns one webview panel's full lifecycle: initial HTML, the postMessage protocol, the periodic
 * dashboard refresh, and the per-selected-task WebSocket connection. Everything it delegates to
 * (chatViewModel, dashboardViewModel, apiClient, taskSocket) is unit tested on its own; this class
 * itself is glue verified manually in the Extension Development Host (see this package's README).
 */
class MaddoxBotPanel implements vscode.Disposable {
  private readonly api: MaddoxApiClient;
  private chatState: ChatState;
  private dashboardState: DashboardState = createDashboardState();
  private socket: WebSocket | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly apiBaseUrl: string,
    private readonly repositoryId: string,
  ) {
    this.api = new FetchMaddoxApiClient(apiBaseUrl);
    this.chatState = createChatState(repositoryId);

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
    );
    panel.webview.html = getWebviewHtml(scriptUri.toString(), nonce(), panel.webview.cspSource);

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw);
    });
    panel.onDidDispose(() => this.dispose());
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!isWebviewToHostMessage(raw)) {
      return;
    }
    switch (raw.type) {
      case "ready":
        await this.refreshDashboard();
        this.refreshTimer = setInterval(() => void this.refreshDashboard(), REFRESH_INTERVAL_MS);
        this.render();
        return;
      case "chatSubmit": {
        const previousTaskId = this.chatState.currentTaskId;
        this.chatState = await submitChatInput(this.chatState, raw.text, this.api);
        if (this.chatState.currentTaskId && this.chatState.currentTaskId !== previousTaskId) {
          this.selectAndStreamTask(this.chatState.currentTaskId);
          await this.refreshDashboard();
        }
        this.render();
        return;
      }
      case "selectTask":
        this.selectAndStreamTask(raw.taskId);
        this.render();
        return;
      case "decideApproval":
        await this.api.decideApproval(raw.approvalId, raw.decision);
        await this.refreshDashboard();
        this.render();
        return;
    }
  }

  private selectAndStreamTask(taskId: string): void {
    this.socket?.close();
    this.dashboardState = selectTask(this.dashboardState, taskId);
    this.socket = connectTaskStream(this.apiBaseUrl, taskId, {
      onMessage: (message) => {
        if (message.type === "update") {
          this.dashboardState = applyStreamUpdate(this.dashboardState, taskId, message);
        } else {
          void vscode.window.showWarningMessage(`Maddox Bot: ${message.message}`);
        }
        this.render();
      },
    });
  }

  private async refreshDashboard(): Promise<void> {
    const [tasks, approvals] = await Promise.all([
      this.api.listTasks(this.repositoryId),
      this.api.listPendingApprovals(),
    ]);
    this.dashboardState = applyPendingApprovals(
      applyTaskList(this.dashboardState, tasks),
      approvals,
    );
  }

  private render(): void {
    const message: HostToWebviewMessage = {
      type: "render",
      chat: { messages: this.chatState.messages },
      dashboard: this.dashboardState,
    };
    void this.panel.webview.postMessage(message);
  }

  /** Idempotent: closing an already-closed socket or clearing an already-cleared timer is a
   * documented no-op, so it's safe to run both from panel.onDidDispose (tab closed) and again from
   * context.subscriptions (extension deactivated) without tracking whether it already ran. */
  dispose(): void {
    this.socket?.close();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const openPanel = vscode.commands.registerCommand("maddoxBot.openPanel", () => {
    const config = readConfig();
    if (!config.repositoryId) {
      void vscode.window.showErrorMessage(
        "Maddox Bot: set `maddoxBot.repositoryId` in settings before opening the panel — see this extension's README for how to find it.",
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "maddoxBot",
      "Maddox Bot",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    const controller = new MaddoxBotPanel(
      panel,
      context.extensionUri,
      config.apiBaseUrl,
      config.repositoryId,
    );
    context.subscriptions.push(panel, controller);
  });

  context.subscriptions.push(openPanel);
}
