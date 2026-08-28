import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitClient } from "@maddox-bot/git";
import { simpleGit } from "simple-git";
import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "./sandbox.js";

const IMAGE = "maddox-bot-sandbox:latest";
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/sample-repo",
);

describe("Sandbox end-to-end (plan increment 8's own verification scenario)", () => {
  let workDir: string;
  let bareRepoPath: string;
  let clonePath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "maddox-bot-sandbox-e2e-"));
    bareRepoPath = join(workDir, "sample-repo.git");
    clonePath = join(workDir, "clone");

    // Turn the committed fixture files into a real, clonable local repo — there's no nested .git
    // committed inside this monorepo (see tests/fixtures/README.md).
    const seedPath = join(workDir, "seed");
    await cp(FIXTURE_PATH, seedPath, { recursive: true });
    const seed = simpleGit(seedPath);
    await seed.init(false, ["--initial-branch=main"]);
    await seed.addConfig("user.email", "bot@example.com");
    await seed.addConfig("user.name", "Bot");
    await seed.add(".");
    await seed.commit("chore: initial commit");

    await mkdir(bareRepoPath, { recursive: true });
    await simpleGit(bareRepoPath).init(true);
    await seed.addRemote("origin", bareRepoPath);
    await seed.push("origin", "main");
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("clones the fixture repo, installs, runs its tests, and destroys the sandbox cleanly", async () => {
    const client = await GitClient.clone({ url: bareRepoPath, directory: clonePath });
    expect((await client.status()).current).toBe("main");

    const sandbox = await Sandbox.create({ image: IMAGE, hostWorkspacePath: clonePath });
    const containerId = sandbox.id;
    try {
      const install = await sandbox.exec(["pnpm", "install"]);
      expect(install.exitCode, `pnpm install failed: ${install.stderr}`).toBe(0);

      const test = await sandbox.exec(["pnpm", "test"]);
      expect(test.exitCode, `pnpm test failed: ${test.stderr}`).toBe(0);
      expect(test.stdout).toMatch(/pass\s+1/i);
    } finally {
      await sandbox.destroy();
    }

    // Precise rather than a global "zero sandbox-labeled containers" count: other test files in
    // this package create and clean up their own labeled containers, potentially concurrently, so
    // a global count would be flaky. This proves destroy() actually removed *this* container.
    const docker = new Docker();
    await expect(docker.getContainer(containerId).inspect()).rejects.toThrow();
  }, 60000);
});
