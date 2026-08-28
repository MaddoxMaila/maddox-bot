import { PassThrough } from "node:stream";
import Docker from "dockerode";
import type { ExecOptions, ExecResult, SandboxOptions } from "./sandboxOptions.js";

const DEFAULT_CONTAINER_WORKSPACE = "/workspace";
const DEFAULT_PIDS_LIMIT = 256;

/** Every container this package creates carries this label, so leaked-container checks (tests,
 * ops tooling) can find them without guessing at naming conventions. */
export const SANDBOX_LABEL = "com.maddox-bot.sandbox";

/**
 * One Docker container per task. The worker holds the Docker socket and is therefore a trust
 * boundary (see ADR-0001): it must only ever spawn sandbox containers via this class, never run
 * repository-supplied code itself. Task containers get no socket, a read-only root filesystem,
 * dropped capabilities, and resource limits.
 *
 * Known Phase 1 gap, not solved here: no network egress allowlisting (ADR-0001, security README).
 */
export class Sandbox {
  private constructor(
    private readonly docker: Docker,
    private readonly container: Docker.Container,
  ) {}

  static async create(options: SandboxOptions): Promise<Sandbox> {
    const docker = new Docker();
    await assertImageExists(docker, options.image);

    const containerWorkspacePath = options.containerWorkspacePath ?? DEFAULT_CONTAINER_WORKSPACE;
    const limits = options.limits ?? {};

    const container = await docker.createContainer({
      Image: options.image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: containerWorkspacePath,
      Labels: { [SANDBOX_LABEL]: "true" },
      HostConfig: {
        Binds: [`${options.hostWorkspacePath}:${containerWorkspacePath}`],
        ReadonlyRootfs: true,
        // A read-only rootfs still needs somewhere writable: /tmp for general tool use, and /root
        // (the default $HOME for this image's root user) because package managers write caches
        // and config there unprompted — pnpm/corepack fail outright without it, not just warn.
        Tmpfs: { "/tmp": "rw,size=256m", "/root": "rw,size=256m" },
        ...(limits.cpus !== undefined && { NanoCpus: Math.round(limits.cpus * 1e9) }),
        ...(limits.memoryMb !== undefined && { Memory: limits.memoryMb * 1024 * 1024 }),
        PidsLimit: limits.pidsLimit ?? DEFAULT_PIDS_LIMIT,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
      },
    });

    await container.start();
    return new Sandbox(docker, container);
  }

  get id(): string {
    return this.container.id;
  }

  async exec(command: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const execInstance = await this.container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await execInstance.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    this.docker.modem.demuxStream(stream, stdout, stderr);

    const timedOut = await new Promise<boolean>((resolve) => {
      const timeout =
        options.timeoutMs !== undefined
          ? setTimeout(() => {
              stream.destroy();
              resolve(true);
            }, options.timeoutMs)
          : undefined;
      stream.on("end", () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(false);
      });
    });

    const inspectResult = await execInstance.inspect();
    return {
      exitCode: inspectResult.ExitCode ?? -1,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      timedOut,
    };
  }

  async destroy(): Promise<void> {
    await this.container.remove({ force: true });
  }
}

async function assertImageExists(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    throw new Error(
      `Sandbox image "${image}" not found locally. Build it first — see infrastructure/docker/README.md.`,
    );
  }
}
