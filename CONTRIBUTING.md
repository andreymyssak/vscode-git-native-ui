# Contributing

Use [issues](https://github.com/andreymyssak/vscode-git-native-ui/issues) for bugs and feature requests. For vulnerabilities, follow the private reporting instructions in [SECURITY.md](SECURITY.md).

## Make a change

1. Fork the repository and create a branch for your change.
2. Follow [development setup](docs/development.md) to install dependencies and run the extension.
3. Read the relevant code and tests. Use [architecture](docs/architecture.md) to locate modules and [DESIGN.md](DESIGN.md) for UI changes.
4. Implement a focused change and maintain its [behavior tests](docs/testing.md#maintain-tests-with-behavior-changes). Test Git mutations only in disposable repositories.

Update user documentation when behavior changes. For copied VS Code code, follow [VS Code maintenance](docs/upstream.md).

## Validate your change

Run the project checks before committing:

```sh
npm run check
```

Use [testing](docs/testing.md#choose-affected-checks) to choose additional browser, native, or installed-extension checks. Keep temporary logs and screenshots in `.artifacts/`.

## Write commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Start with a type, an optional scope in parentheses, and a short description of the change:

```text
feat(worktrees): add worktree creation
fix(graph): keep commit selection after refresh
docs: clarify installation steps
refactor(git): extract branch deletion
```

Use `feat` for new functionality and `fix` for bug fixes. Other types include `docs`, `refactor`, `test`, `perf`, `build`, `ci`, and `chore`.

For a breaking change, add `!` after the type or scope, or a `BREAKING CHANGE:` footer. Explain the incompatibility and migration in the message.

Release tooling uses these messages to recommend versions: `fix` for patch, `feat` for minor, and breaking changes for major. Version bumps and changelog updates belong to [release preparation](docs/releasing.md).

## Open a pull request

Explain the problem, resulting behavior, and checks you ran. Link a related issue when available. For UI changes, include a screenshot or short recording with private information removed.

## Licenses

Submit original code you have the right to contribute under the project's [MIT license](LICENSE.txt). Preserve existing copyright and license notices.

When copying code or adding bundled dependencies or assets, record their source and license in [third-party notices](THIRD_PARTY_NOTICES.md). Ensure the VSIX includes their required attribution and license text.

For agent-assisted contributions, follow [AGENTS.md](AGENTS.md). [AI setup](docs/ai-setup.md) describes the optional tools.
