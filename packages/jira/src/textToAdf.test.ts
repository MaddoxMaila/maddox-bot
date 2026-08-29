import { describe, expect, it } from "vitest";
import { textToAdf } from "./textToAdf.js";

describe("textToAdf", () => {
  it("turns each non-empty line into its own paragraph", () => {
    expect(textToAdf("First line\nSecond line")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First line" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
      ],
    });
  });

  it("skips blank lines", () => {
    expect(textToAdf("First\n\nSecond")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    });
  });

  it("produces a single empty paragraph for empty text, not an empty content array", () => {
    expect(textToAdf("")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph" }],
    });
  });
});
