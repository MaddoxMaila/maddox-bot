import { describe, expect, it } from "vitest";
import { adfToPlainText } from "./adfToPlainText.js";

describe("adfToPlainText", () => {
  it("returns an empty string for null or non-object input", () => {
    expect(adfToPlainText(null)).toBe("");
    expect(adfToPlainText(undefined)).toBe("");
    expect(adfToPlainText("not an adf doc")).toBe("");
  });

  it("renders a single paragraph", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    expect(adfToPlainText(doc)).toBe("Hello world");
  });

  it("renders multiple paragraphs on separate lines", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second." }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe("First.\nSecond.");
  });

  it("renders a bullet list with '- ' prefixes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "User can request a reset" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Invalid email is rejected" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("- User can request a reset\n- Invalid email is rejected");
  });

  it("renders a hard break as a newline within a paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Line one" },
            { type: "hardBreak" },
            { type: "text", text: "Line two" },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("Line one\nLine two");
  });

  it("renders a heading like a paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Acceptance criteria" }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("Acceptance criteria");
  });
});
