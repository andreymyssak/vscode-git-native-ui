# AI setup

## Project skills

Install [APM](https://microsoft.github.io/apm/getting-started/installation/), then run from the repository root:

```sh
npm run ai:install
npm run ai:audit
```

APM installs the locked Unslop, Technical Writing and TypeScript Best Practices skills under `.agents/skills/`, including the TypeScript skill's type-system and boundary principles. The repository includes [Write ADR](../.agents/skills/write-adr/SKILL.md), a compact MADR-based guide for decision records. Start a new agent session after installation.

`apm.yml` and `apm.lock.yaml` record external dependencies. CI pins the installer version in `.github/workflows/ai-setup.yml`.

To update an external skill, change its manifest entry, regenerate the lock with `apm install`, and review the changes. Keep downloaded skills and `apm_modules/` out of Git and the VSIX. Edit the repository-owned Write ADR skill directly.

## Native plugins

Install Superpowers through Codex's plugin catalog. Keep one copy enabled. Native plugins belong to the agent installation and are managed separately from project skills.

Tested APM 0.33.0 with Superpowers 6.4.2 and Codex CLI 0.162.0-alpha.2 on 2026-10-09. All 15 skills installed and appeared in Codex's catalog. The generated `SessionStart` hook failed because it looked for `using-superpowers` under `.codex/hooks/superpowers/skills/` instead of `.agents/skills/`. APM's audit passed despite that runtime failure.

Retest after APM fixes Codex hook deployment. Use the native plugin until then.

## CodeGraph

[CodeGraph](https://github.com/colbymchenry/codegraph#quick-start) is an optional local CLI/MCP tool. Follow its own setup when needed; it is not part of the APM lock or extension dependencies. Its repository index stays in ignored `.codegraph/`. Agent usage rules live in [AGENTS.md](../AGENTS.md).
