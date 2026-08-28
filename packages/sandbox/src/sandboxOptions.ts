export interface SandboxLimits {
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
}

export interface SandboxOptions {
  image: string;
  /** An existing host directory (typically a GitClient clone) to bind-mount as the workspace. */
  hostWorkspacePath: string;
  containerWorkspacePath?: string;
  limits?: SandboxLimits;
}

export interface ExecOptions {
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
