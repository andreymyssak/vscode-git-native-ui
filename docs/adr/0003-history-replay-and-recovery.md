# Let Git rewrite history and VS Code handle conflicts

Accepted 2026-10-09, recording the existing implementation.

## Context

Editing an older commit message or combining selected commits with Squash requires Git to recreate those commits and their later descendants. VS Code's public Git API does not provide those selected-commit operations.

If Git stops for a conflict, the user must be able to continue through VS Code and retain the message they approved.

## Alternatives

- Use VS Code's ordinary rebase API. It cannot express which commits to combine or which message to replace.
- Prepare an interactive Git rebase and use VS Code's existing conflict tools. This is the existing choice.

## Decision

The extension checks the selected history and collects the final message in a native editor. A bundled helper prepares Git's interactive rebase instructions. Git then reapplies the commits in order, replacing the chosen message or combining the selected commits.

Store the approved message in a temporary Git commit that changes no files and does not appear on the resulting branch. Git can reuse that message when the user chooses **Continue**, even after the Git command that started the rebase exits. Relying only on that process's editor settings would lose this guarantee.

Keep recovery files associated with the repository until Git finishes. VS Code handles conflict editing, staging, **Continue**, and **Abort**. The extension does not automatically stash changes, abort, roll back, or retry a stopped operation. Cleanup removes only the extension's verified completed recovery files.

## Consequences

Git owns the history rewrite and VS Code owns conflict resolution. We maintain the helper and recovery files instead of a separate conflict workflow.

The approach requires Git 2.47 or newer and history without root or merge commits in the rewritten range. Combining separated commits can cause conflicts. The extension checks automatically completed results; manual continuation follows the user's resolutions and Git's handling of empty commits. **Abort** applies while a rebase is unfinished, not after completion.

Eligibility checks are exercised in [history preflight tests](../../test/integration/squash-preflight.test.ts). See [testing](../testing.md) for validation. The message-preservation mechanism lives in [squash recovery](../../src/extension/git/squash-recovery.ts) and the [rebase helper](../../src/extension/git/squash-helper.ts).
