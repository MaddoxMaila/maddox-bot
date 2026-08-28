import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Docker from "dockerode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, SANDBOX_LABEL } from "./sandbox.js";

const IMAGE = "maddox-bot-sandbox:latest";

describe("Sandbox", () => {
  let hostWorkspacePath: string;
  let sandbox: Sandbox | undefined;

  beforeEach(async () => {
    hostWorkspacePath = await mkdtemp(join(tmpdir(), "maddox-bot-sandbox-test-"));
  });

  afterEach(async () => {
    await sandbox?.destroy();
    sandbox = undefined;
    await rm(hostWorkspacePath, { recursive: true, force: true });
  });

  it("runs a command inside the container and captures stdout", async () => {
    sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    const result = await sandbox.exec(["echo", "hello from sandbox"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello from sandbox");
    expect(result.timedOut).toBe(false);
  });

  it("captures a non-zero exit code and stderr separately from stdout", async () => {
    sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    const result = await sandbox.exec(["sh", "-c", "echo out; echo err >&2; exit 3"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
  });

  it("sees the bind-mounted host workspace at the container workspace path", async () => {
    sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    await sandbox.exec(["sh", "-c", "echo content > marker.txt"]);
    const result = await sandbox.exec(["cat", "marker.txt"]);
    expect(result.stdout.trim()).toBe("content");
  });

  it("marks a command that exceeds its timeout as timed out", async () => {
    sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    const result = await sandbox.exec(["sleep", "5"], { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
  }, 10000);

  it("creates the container with the requested resource limits and security posture", async () => {
    sandbox = await Sandbox.create({
      image: IMAGE,
      hostWorkspacePath,
      limits: { cpus: 1, memoryMb: 256, pidsLimit: 64 },
    });
    const docker = new Docker();
    const info = await docker.getContainer(sandbox.id).inspect();

    expect(info.HostConfig.NanoCpus).toBe(1_000_000_000);
    expect(info.HostConfig.Memory).toBe(256 * 1024 * 1024);
    expect(info.HostConfig.PidsLimit).toBe(64);
    expect(info.HostConfig.ReadonlyRootfs).toBe(true);
    expect(info.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(info.Config.Labels?.[SANDBOX_LABEL]).toBe("true");
  });

  it("applies a default PidsLimit when none is given", async () => {
    sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    const docker = new Docker();
    const info = await docker.getContainer(sandbox.id).inspect();
    expect(info.HostConfig.PidsLimit).toBe(256);
    expect(info.HostConfig.NanoCpus).toBeFalsy();
    expect(info.HostConfig.Memory).toBe(0);
  });

  it("destroy leaves no container behind", async () => {
    const created = await Sandbox.create({ image: IMAGE, hostWorkspacePath });
    const docker = new Docker();
    await created.destroy();

    await expect(docker.getContainer(created.id).inspect()).rejects.toThrow();
    sandbox = undefined;
  });

  it("throws a clear error when the image does not exist locally", async () => {
    await expect(
      Sandbox.create({ image: "maddox-bot-sandbox-does-not-exist:latest", hostWorkspacePath }),
    ).rejects.toThrow(/not found locally/);
  });
});
