/**
 * The webview's static HTML shell. Pure string templating — no `vscode`/DOM dependency — so it's
 * unit-testable, unlike main.ts (which runs inside the webview's own DOM sandbox and is verified
 * manually in the Extension Development Host instead; see this package's README).
 */
export function getWebviewHtml(scriptUri: string, nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>Maddox Bot</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0.5rem 1rem;
  }
  h2 { font-size: 1em; margin: 1rem 0 0.25rem; opacity: 0.85; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.25rem 0; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
  #chat-log li { white-space: pre-wrap; }
  #chat-log .role-user { font-weight: 600; }
  #chat-log .role-assistant { opacity: 0.9; }
  .task-row { display: flex; justify-content: space-between; cursor: pointer; }
  .task-row.selected { background: var(--vscode-list-activeSelectionBackground); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  #chat-form { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
  #chat-input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 0.3rem;
  }
</style>
</head>
<body>
  <div id="app">
    <section id="dashboard">
      <h2>Tasks</h2>
      <ul id="task-list"></ul>
      <h2>Pending approvals</h2>
      <ul id="approval-list"></ul>
      <h2>Selected task events</h2>
      <ul id="event-list"></ul>
    </section>
    <section id="chat">
      <h2>Chat</h2>
      <ul id="chat-log"></ul>
      <form id="chat-form">
        <input id="chat-input" type="text" placeholder="implement PROJ-123" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
