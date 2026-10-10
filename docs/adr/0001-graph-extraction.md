# Reuse VS Code's graph layout in the webview

Accepted 2026-10-04.

## Context

Git UI needs a commit graph consistent with VS Code Source Control. The upstream graph module depends on private workbench services that the webview cannot import.

## Alternatives

- Adapt the graph layout and drawing functions with their required helpers. This is the existing choice.
- Copy the graph's private workbench services as well. That would couple the webview to internal theme, hover, and rendering services outside its runtime.

## Decision

Reuse VS Code's lane allocation, SVG drawing, and reference-ordering helpers. Replace private imports with portable types, browser SVG methods, and VS Code theme color identifiers. Keep product state and actions in the application.

Retain the upstream palette as a fallback when graph theme colors are unavailable. Native theme colors take precedence.

Preserve the original source inputs and record adaptations as patches. [The upstream manifest](../../upstream/vscode/manifest.json) records their hashes and adopted revisions. Generate `src/vendor/vscode-graph/` from those inputs rather than editing it directly.

## Consequences

We reuse VS Code's layout behavior, but must review upstream changes and maintain the adaptation patches. Graph fixtures cover linear history and merges, including a three-parent merge. Reproduction checks hashes, rejects private imports, and compares generated output with the committed files.

[VS Code maintenance](../upstream.md) describes how to review, prepare, and adopt changes.
