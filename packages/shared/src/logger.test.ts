import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function createCapturingLogger(name: string) {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });
  const logger = createLogger(name, destination);
  const lastLine = (): unknown => JSON.parse(lines[lines.length - 1] ?? "");
  return { logger, lastLine };
}

describe("createLogger", () => {
  it("emits structured JSON with the given logger name", () => {
    const { logger, lastLine } = createCapturingLogger("test-logger");
    logger.info("hello");
    expect(lastLine()).toMatchObject({ name: "test-logger", msg: "hello" });
  });

  it("redacts top-level secret-shaped fields", () => {
    const { logger, lastLine } = createCapturingLogger("test-logger");
    logger.info({ token: "sk-secret", ok: true }, "did a thing");
    expect(lastLine()).toMatchObject({ token: "[REDACTED]", ok: true });
  });

  it("redacts one level of nested secret-shaped fields", () => {
    const { logger, lastLine } = createCapturingLogger("test-logger");
    logger.info({ integration: { apiKey: "sk-secret" } }, "did a thing");
    expect(lastLine()).toMatchObject({ integration: { apiKey: "[REDACTED]" } });
  });

  it("works with no explicit destination (defaults to stdout)", () => {
    const logger = createLogger("test-logger");
    expect(typeof logger.info).toBe("function");
  });

  it("child() inherits bindings without mutating the parent", () => {
    const { logger, lastLine } = createCapturingLogger("test-logger");
    const child = logger.child({ taskId: "task-1" });
    child.info("child event");
    expect(lastLine()).toMatchObject({ name: "test-logger", taskId: "task-1", msg: "child event" });
  });
});
