import { simpleGit, type SimpleGit } from "simple-git";
import { buildAuthenticatedCloneUrl } from "./authenticatedCloneUrl.js";

export interface GitIdentity {
  name: string;
  email: string;
}

export interface CloneOptions {
  url: string;
  directory: string;
  token?: string;
  /** A fresh clone has no local git identity — set one whenever the caller intends to commit. */
  identity?: GitIdentity;
}

export interface GitStatus {
  current: string;
  files: string[];
  isClean: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

export interface DiffOptions {
  base?: string;
  staged?: boolean;
}

export interface PushOptions {
  remote?: string;
  force?: boolean;
}

/**
 * Operates on a local working directory — the host's clone of a target repository, which also
 * happens to be bind-mounted into a task's sandbox container. This package doesn't know or care
 * about the container; cloning/committing/pushing are trusted operations run directly by the
 * worker, not by anything inside the sandbox. See the package README.
 */
export class GitClient {
  private readonly git: SimpleGit;

  constructor(readonly directory: string) {
    this.git = simpleGit(directory);
  }

  static async clone(options: CloneOptions): Promise<GitClient> {
    const authenticatedUrl = buildAuthenticatedCloneUrl(options.url, options.token);
    await simpleGit().clone(authenticatedUrl, options.directory);
    const client = new GitClient(options.directory);
    if (options.identity) {
      await client.setIdentity(options.identity);
    }
    return client;
  }

  async setIdentity(identity: GitIdentity): Promise<void> {
    await this.git.addConfig("user.name", identity.name);
    await this.git.addConfig("user.email", identity.email);
  }

  async status(): Promise<GitStatus> {
    const status = await this.git.status();
    return {
      current: status.current ?? "",
      files: status.files.map((file) => file.path),
      isClean: status.isClean(),
    };
  }

  async diff(options: DiffOptions = {}): Promise<string> {
    const args: string[] = [];
    if (options.staged) {
      args.push("--staged");
    }
    if (options.base) {
      args.push(options.base);
    }
    return this.git.diff(args);
  }

  async log(options: { maxCount?: number } = {}): Promise<GitLogEntry[]> {
    const log = await this.git.log({ maxCount: options.maxCount ?? 20 });
    return log.all.map((entry) => ({ hash: entry.hash, message: entry.message, date: entry.date }));
  }

  async branch(): Promise<{ current: string; all: string[] }> {
    const summary = await this.git.branchLocal();
    return { current: summary.current, all: summary.all };
  }

  async createBranch(name: string, from?: string): Promise<void> {
    if (from) {
      await this.git.checkoutBranch(name, from);
    } else {
      await this.git.checkoutLocalBranch(name);
    }
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  async commit(message: string, files?: string[]): Promise<{ sha: string }> {
    await this.git.add(files && files.length > 0 ? files : ".");
    const result = await this.git.commit(message);
    return { sha: result.commit };
  }

  async push(branch: string, options: PushOptions = {}): Promise<void> {
    const remote = options.remote ?? "origin";
    if (options.force) {
      await this.git.push(remote, branch, ["--force"]);
    } else {
      await this.git.push(remote, branch);
    }
  }
}
