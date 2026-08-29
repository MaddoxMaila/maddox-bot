import * as vscode from "vscode";

export interface MaddoxBotConfig {
  apiBaseUrl: string;
  repositoryId: string | null;
}

export function readConfig(): MaddoxBotConfig {
  const config = vscode.workspace.getConfiguration("maddoxBot");
  const repositoryId = config.get<string>("repositoryId", "");
  return {
    apiBaseUrl: config.get<string>("apiBaseUrl", "http://localhost:3000"),
    repositoryId: repositoryId.length > 0 ? repositoryId : null,
  };
}
