# Git Native UI

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)

Browse branches, commit history, changed files, and worktrees together in VS Code. Git Native UI puts them in a bottom panel, with comparisons opening in VS Code's native diff editors.

Inspired by the Git tool window in JetBrains' [IntelliJ IDEA Community Edition](https://github.com/JetBrains/intellij-community), with VS Code's graph, controls, and themes.

![Git Native UI in VS Code's Dark Modern theme, showing branches, a commit graph, and changed files](assets/readme/log-dark.png)

## What you can do

- **Explore history.** Browse local branches, remote branches, and tags. Filter commits by text, revision, author, or date.
- **Inspect changes.** Select a commit to see its message and files. Compare merge commits with each parent and open file diffs in the editor.
- **Manage branches.** Check out, create, rename, delete, update, merge, or rebase. Restore an accidentally deleted branch from its notification.
- **Work with commits.** Cherry-pick, edit messages, squash, or drop eligible commits. Create a branch or tag from a commit.
- **Use worktrees.** Create a working folder for a branch, open it in this window or a new one, and remove it when finished.

Branch, commit, and worktree lists support multiple selection. Use VS Code's Source Control and editors to resolve conflicts.

## See it in action

Select commits, inspect merge parents, open changed files in the diff editor, filter history, and switch to worktrees:

![Demo of commit selection, opening a changed file in VS Code's diff editor, history search, and worktrees in Git Native UI](assets/readme/browsing.gif)

The panel follows your VS Code theme. Here it is in Light Modern:

![Git Native UI in VS Code's Light Modern theme](assets/readme/log-light.png)

## Install

The first public release is in preparation. **Marketplace listing: coming soon.**

<!-- Replace the Marketplace placeholder with the final listing URL after publication.
Add Marketplace version and install-count badges using the final publisher ID.
Until then, avoid badges that imply a published release or an install count. -->

For now, [build a VSIX from source](docs/development.md#build-and-run), then run **Extensions: Install from VSIX...** in VS Code.

1. Open a local Git repository in VS Code.
2. Run **View: Open View...** from the Command Palette and choose **Git Native UI**.
3. Select a commit, or double-click a branch to browse its history. Browsing a branch keeps your checkout unchanged.

Requires VS Code 1.140.0 or newer, Git, an enabled built-in Git extension, and workspace trust for Git operations.

## Your repositories stay yours

Git Native UI has no account, cloud backend, or analytics service. Fetch connects to your configured Git remotes using VS Code's Git authentication.

## Feedback and contributions

[Report a bug or suggest a feature](https://github.com/andreymyssak/git-native-ui/issues). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

For security vulnerabilities, follow the private reporting instructions in [SECURITY.md](SECURITY.md).

## License

Authored code is [MIT licensed](LICENSE.txt). Bundled Microsoft code and libraries retain their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
