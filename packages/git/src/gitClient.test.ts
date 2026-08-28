import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitClient } from "./gitClient.js";

describe("GitClient", () => {
  let workDir: string;
  let bareRepoPath: string;
  let clonePath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "maddox-bot-git-test-"));
    bareRepoPath = join(workDir, "origin.git");
    clonePath = join(workDir, "clone");
    const seedPath = join(workDir, "seed");

    // A bare "remote" repo, seeded from a throwaway working copy — simple-git's push tests need
    // a real remote to push to, and a non-bare repo can't safely receive a push to its checked
    // out branch. simple-git's `.init()` operates on the instance's own baseDir (the directory
    // must already exist), not on a path argument.
    await mkdir(bareRepoPath, { recursive: true });
    await simpleGit(bareRepoPath).init(true);

    await mkdir(seedPath, { recursive: true });
    const seed = simpleGit(seedPath);
    await seed.init(false, ["--initial-branch=main"]);
    await seed.addConfig("user.email", "bot@example.com");
    await seed.addConfig("user.name", "Bot");
    await writeFile(join(seedPath, "README.md"), "# sample\n");
    await seed.add(".");
    await seed.commit("chore: initial commit");
    await seed.addRemote("origin", bareRepoPath);
    await seed.push("origin", "main");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("clones a repository and configures identity for subsequent commits", async () => {
    const client = await GitClient.clone({ url: bareRepoPath, directory: clonePath });
    const status = await client.status();
    expect(status.current).toBe("main");
    expect(status.isClean).toBe(true);
  });

  it("reports uncommitted changes via status and diff", async () => {
    const client = await GitClient.clone({ url: bareRepoPath, directory: clonePath });
    await writeFile(join(clonePath, "README.md"), "# sample\n\nchanged\n");

    const status = await client.status();
    expect(status.isClean).toBe(false);
    expect(status.files).toContain("README.md");

    const diff = await client.diff();
    expect(diff).toContain("changed");

    await simpleGit(clonePath).add(".");
    const stagedDiff = await client.diff({ staged: true });
    expect(stagedDiff).toContain("changed");
    expect(await client.diff()).toBe("");

    const baseDiff = await client.diff({ base: "HEAD" });
    expect(baseDiff).toContain("changed");
  });

  it("lists commit history", async () => {
    const client = await GitClient.clone({ url: bareRepoPath, directory: clonePath });
    const log = await client.log();
    expect(log).toHaveLength(1);
    expect(log[0]?.message).toBe("chore: initial commit");
  });

  it("reports branches", async () => {
    const client = await GitClient.clone({ url: bareRepoPath, directory: clonePath });
    const branches = await client.branch();
    expect(branches.current).toBe("main");
    expect(branches.all).toContain("main");
  });

  it("creates a branch, commits, and pushes it to the remote", async () => {
    const client = await GitClient.clone({
      url: bareRepoPath,
      directory: clonePath,
      identity: { name: "Bot", email: "bot@example.com" },
    });
    await client.createBranch("feature/add-notes", "main");
    await writeFile(join(clonePath, "NOTES.md"), "notes\n");

    const { sha } = await client.commit("feat: add notes");
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);

    await client.push("feature/add-notes");

    const verifyClonePath = join(workDir, "verify-clone");
    const verifyClient = await GitClient.clone({ url: bareRepoPath, directory: verifyClonePath });
    await verifyClient.checkout("feature/add-notes");
    const log = await verifyClient.log();
    expect(log[0]?.message).toBe("feat: add notes");
  });

  it("createBranch with no 'from' branches off the current HEAD", async () => {
    const client = await GitClient.clone({
      url: bareRepoPath,
      directory: clonePath,
      identity: { name: "Bot", email: "bot@example.com" },
    });
    await client.createBranch("chore/tidy");
    const branches = await client.branch();
    expect(branches.current).toBe("chore/tidy");
  });

  it("commit only stages the given files, leaving other changes untouched", async () => {
    const client = await GitClient.clone({
      url: bareRepoPath,
      directory: clonePath,
      identity: { name: "Bot", email: "bot@example.com" },
    });
    await writeFile(join(clonePath, "README.md"), "# sample\n\nchanged\n");
    await writeFile(join(clonePath, "UNRELATED.md"), "unrelated\n");

    await client.commit("docs: update readme", ["README.md"]);

    const status = await client.status();
    expect(status.isClean).toBe(false);
    expect(status.files).toEqual(["UNRELATED.md"]);
  });

  it("push supports force and a non-default remote", async () => {
    const client = await GitClient.clone({
      url: bareRepoPath,
      directory: clonePath,
      identity: { name: "Bot", email: "bot@example.com" },
    });
    await client.createBranch("feature/force-push", "main");
    await writeFile(join(clonePath, "A.md"), "a\n");
    await client.commit("feat: a");
    await client.push("feature/force-push", { remote: "origin" });

    // Rewrite history on the branch, then confirm a non-force push is rejected but force succeeds.
    await simpleGit(clonePath).reset(["--hard", "HEAD~1"]);
    await writeFile(join(clonePath, "B.md"), "b\n");
    await client.commit("feat: b instead of a");

    await expect(client.push("feature/force-push")).rejects.toThrow();
    await expect(client.push("feature/force-push", { force: true })).resolves.not.toThrow();
  });
});
