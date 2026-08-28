# Security notes

Tracking ground, per spec §22/§23, as Phase 1 lands. Threats this platform must specifically defend
against (repository code and Jira/PR content are untrusted input): prompt injection via ticket or
review-comment text, malicious repository instructions attempting to override platform policy,
malicious test/build scripts, dependency attacks, secret exfiltration, sandbox escape, and
unauthorized GitHub/Jira access. Repository-embedded instructions must never override system-level
policy — the agent must always be able to distinguish "repository content" from "platform
instructions."

## Trust boundaries (Phase 1)

- The **worker process** holds the Docker socket used to spawn sandbox containers. It is therefore
  fully trusted and must never execute repository-supplied code itself — only spawn an isolated
  container to do so. See `docs/adr/0001-phase-1-stack.md`.
- **Task sandbox containers** run untrusted repository code (install scripts, tests, build steps).
  No Docker socket, no `--privileged`, read-only root filesystem plus a workspace volume, dropped
  capabilities, CPU/memory/pid/timeout limits. Network egress allowlisting is a known, not-yet-closed
  gap (see the ADR's Consequences).
- **Secrets** (GitHub PAT, Jira API token, Anthropic API key) live in `.env` (gitignored) locally;
  `integrations.config` in the database stores references, not raw secrets. Nothing repository-supplied
  is ever placed in an environment variable available to a sandbox container.

## Not yet addressed (tracked, not silently skipped)

- Sandbox network egress allowlisting.
- A real secrets manager (env vars are the Phase-1 stopgap; see the ADR).
- SSRF protections on any tool that fetches user/repo-supplied URLs — must be addressed before such a
  tool is added.

This file will gain a proper checklist (mirroring `templates/security-checklist.md`-style structure)
once there is code to review against it.
