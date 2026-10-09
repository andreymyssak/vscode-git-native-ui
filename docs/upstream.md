# Update the VS Code integration

Keep original VS Code files and adaptation patches in `upstream/vscode/`. Generate the graph used by the extension in `src/vendor/vscode-graph/`. [The manifest](../upstream/vscode/manifest.json) records source revisions and hashes.

The installed Git API updates with VS Code; copied graph code changes when we adopt a source revision. Review each stable VS Code feature release and check again before an extension release.

## Review a revision

Supply the full upstream commit and the matching official release-notes URL:

```sh
npm run upstream:report -- FULL_COMMIT --notes-url https://code.visualstudio.com/updates/v1_140 --out .artifacts/upstream-report.json
```

The report verifies current inputs and patches, then compares recorded files and release notes. Resolve failed requests and investigate missing or moved files before completing the review. Read the Source Control release notes and follow links to new capabilities; the report covers only recorded paths. The notes hash includes the whole page, so editorial changes can also trigger review.

For each changed or missing entry, set `disposition` in a reviewed copy of the report:

| Type                              | Meaning                                              |
| --------------------------------- | ---------------------------------------------------- |
| already supplied by installed API | Installed VS Code supplies the behavior we use.      |
| integration required              | Adapt our API/command wiring and add affected tests. |
| source adaptation required        | Update originals and adaptation patches.             |
| deferred                          | Record a nonempty `reason` and `revisit` condition.  |
| not applicable                    | Explain why the change falls outside our workflows.  |

```sh
npm run upstream:report -- --review .artifacts/upstream-report-reviewed.json
```

Validation rejects failures, missing dispositions, and unexplained deferrals. Save reports and test output in `.artifacts/`. Summarize adoption reasons and source links in the commit or PR description. Record lasting architectural decisions in `docs/adr/`.

Update `lastReviewedRevision` after review, retaining each input's adopted revision. Reviewing a revision does not change the adopted code.

## Prepare and adopt changes

```sh
npm run upstream:prepare -- FULL_COMMIT .artifacts/upstream-candidate --notes-url https://code.visualstudio.com/updates/v1_140
```

Use an empty directory. Preparation fetches inputs, retains notices, copies patches, and generates candidate output there. Missing inputs or patch conflicts stop preparation. Review the candidate diff and resolve conflicts in its patches before adoption.

After recording dispositions, copy the reviewed originals, patches, generated output, manifest, and notices into the repository. If adopting only part of a candidate, adjust each adopted input's revision and hash.

Run `npm run upstream:verify`, reproduce into a fresh directory, and run `npm run check`. API or command changes also require native tests against the matching VS Code version. Graph changes require graph fixtures and browser checks. Follow the [release checklist](releasing.md) before distribution.
