import { describe, expect, it } from "vitest";
import { getWebviewHtml } from "./getHtml.js";

describe("getWebviewHtml", () => {
  it("wires the script tag to the given URI and nonce, and sets a matching CSP", () => {
    const html = getWebviewHtml(
      "https://example.test/webview.js",
      "abc123",
      "https://example.test",
    );

    expect(html).toContain('<script nonce="abc123" src="https://example.test/webview.js">');
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("style-src https://example.test");
  });

  it("includes the container elements main.ts expects to find", () => {
    const html = getWebviewHtml("uri", "nonce", "src");

    for (const id of [
      "task-list",
      "approval-list",
      "event-list",
      "chat-log",
      "chat-form",
      "chat-input",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
