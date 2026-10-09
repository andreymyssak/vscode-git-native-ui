# Reuse VS Code Git with explicit exceptions

Accepted 2026-10-09, recording the existing implementation.

## Context

VS Code's Git extension already provides repository discovery, authentication, and most Git actions. Reusing those capabilities keeps Git Native UI integrated with the editor.

Some operations need different behavior. For example, the native worktree deletion API can offer forced removal or return normally after cancellation. Our Delete action must refuse to discard local changes and report whether deletion happened.

## Alternatives

- Use public APIs and native commands for every action. Some lack the required operation or hide the outcome needed to report failure or cancellation.
- Reuse those APIs where they fit, with explicit Git command exceptions for the remaining actions. This is the existing choice.

## Decision

Keep Git writes behind the host adapter, which selects and runs each operation. Prefer public APIs, then verified native commands, then narrow calls to the installed Git executable.

Choose how to run the operation before it starts. Never retry a failed write through another method: Git may already have changed the repository. Run writes one at a time, check that their targets are still current, and report any partial completion.

Worktree deletion uses non-forced `git worktree remove`. Message editing and selected-commit Squash also use explicit Git calls. VS Code continues to provide editors and conflict resolution.

## Consequences

We retain native authentication and UI while controlling the exceptional writes. The cost is maintaining and testing those exceptions as Git and VS Code change. Review them through [VS Code maintenance](../upstream.md).
