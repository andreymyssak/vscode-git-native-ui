# Architecture

Git Native UI has an extension host for Git access and a React webview for presentation.

## Modules

| Location                    | Responsibility                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| `src/extension/activate.ts` | Registers the view and commands.                                   |
| `src/extension/panel/`      | Webview lifecycle, request validation and coordination.            |
| `src/extension/git/`        | Repository reads, serialized Git writes and history recovery.      |
| `src/extension/native/`     | VS Code dialogs, notifications, editors and worktree opening.      |
| `src/shared/`               | Serializable contracts and pure models shared by host and webview. |
| `src/webview/app/`          | Layout, host communication and saved view state.                   |
| `src/webview/pages/`        | Log and Worktrees workflows.                                       |
| `src/webview/shared/`       | Reusable controls, icons and browser bridge.                       |

The webview sends requests to the extension host. The host validates their repository and targets before calling the Git adapter. Repository changes invalidate stale requests.

The Git adapter uses the installed Git extension where possible and explicit Git calls for API gaps. VS Code provides native diffs and conflict resolution. The [backend ADR](adr/0002-git-operation-backends.md) and [history recovery ADR](adr/0003-history-replay-and-recovery.md) explain those choices.

Each webview has its own Zustand store. App owns state restoration; pages own workflow UI. Shared contracts contain no VS Code, Node or DOM dependencies.

## Dependencies and generated code

React handles presentation. TanStack Virtual handles history virtualization, and Floating UI handles popovers. Styling is described in [DESIGN.md](../DESIGN.md).

Only `src/webview/pages/log/lib/graph/` imports `src/vendor/vscode-graph/`. That directory is generated from recorded upstream inputs and patches. Follow [VS Code maintenance](upstream.md) when changing it. [The graph ADR](adr/0001-graph-extraction.md) explains the extraction decision.

Build and validation scripts live in `scripts/`; tests live in `test/`. Generated reports and indexes stay in ignored `.artifacts/` and `.codegraph/`. [Development](development.md) covers setup and [testing](testing.md) covers validation.
