# Working in Git Native UI

Git Native UI is a VS Code extension. Prefer public VS Code Git APIs and native editors/dialogs. Use verified commands or narrow argument-array Git calls behind the adapter when the API lacks an operation.

## Read only relevant docs

- [Architecture](docs/architecture.md) maps modules and ownership.
- [DESIGN.md](DESIGN.md) defines the UI style.
- [Development](docs/development.md) covers setup; [testing](docs/testing.md) covers checks.
- [AI setup](docs/ai-setup.md) covers project skills and optional agent tools.
- [Documentation index](docs/README.md) locates ADRs and release checks.

Read the relevant implementation and tests before changing a workflow. Historical reports are evidence, not instructions. Use helpful skills without loading the full catalog or repeating completed work.

For authored TypeScript, apply the installed [TypeScript Best Practices](.agents/skills/typescript-best-practices/SKILL.md) skill.

Keep temporary plans, investigations and run output in `.artifacts/`. Put lasting decisions in `docs/adr/`.

## Work through completion

User instructions take precedence over skill guidelines. Complete authorized work and affected checks without repeated approval requests. Ask when a missing requirement changes the result. If a skill requires a pause or changes scope, cite its exact instruction and explain the conflict.

## Development contracts

- Follow the setup in [development](docs/development.md); commit lockfiles and use exact dependency versions.
- Keep host logic in `src/extension/`, serializable contracts in `src/shared/`, and presentation in `src/webview/`.
- Reuse maintained dependencies before adding replacement infrastructure.
- Use `rg` for exact searches and CodeGraph when available. Sync stale indexes and verify findings against source. Run `npm run graph` after structural changes.
- Keep tests and fixtures aligned with the latest agreed requirements throughout development. Before completion, apply [test maintenance](docs/testing.md#maintain-tests-with-behavior-changes) and remove coverage that only records superseded requirements or development history.
- Run `npm run check` before committing, plus checks for affected boundaries. Report actual results. Run lint fixes before formatting; keep authored TypeScript within the configured 700-line limit.

## Protected files and Git

Update recorded patches and regenerate instead of editing `upstream/vscode/originals/` or `src/vendor/vscode-graph/` manually. Only the Log graph adapter imports vendor graph code. Keep agent and development tooling out of the VSIX.

Use the [commit convention](CONTRIBUTING.md#write-commit-messages).

Keep Git writes explicit. Do not silently stash, force, abort, or retry a failed write through another backend. Test mutations in disposable repositories. Do not operate on unrelated repositories or push as a side effect of development. Release actions follow explicit session authorization and recorded release gates.
