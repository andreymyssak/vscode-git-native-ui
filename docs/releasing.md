# Release a version

Use release-it to prepare versions and release notes. [Testing](testing.md) covers development validation. This extension is distributed as a VSIX; npm publication is disabled.

## Prepare the version

Start with a clean checkout:

```sh
npm run release:preview
npm run release:prepare
```

Preview shows the proposed version and notes without changing files. Preparation updates `package.json`, `package-lock.json`, and `CHANGELOG.md` without committing, tagging, or pushing.

Release tooling recommends the version from [Conventional Commit messages](../CONTRIBUTING.md#write-commit-messages).

To choose a version, use `npm run release:prepare -- 1.0.0`. For the first release, `npm run release:prepare -- --no-increment` keeps the current version and prepares its notes.

Review the version and release notes. Check publisher, source and support URLs, icon, and license before committing the candidate in a release PR.

## Validate the candidate

```sh
npm run release:validate
```

This runs local, browser, native, and installed-package tests and builds the VSIX. Review passing [extension checks](../.github/workflows/checks.yml) for the release revision on macOS and Windows with minimum and current VS Code versions.

Record the revision, VSIX, test environments, results, and remaining gaps in the release PR. Keep logs in CI artifacts or `.artifacts/`.

## Publish the version

Enable GitHub's private vulnerability reporting and verify the route in [SECURITY.md](../SECURITY.md) before publication.

After the candidate is merged into `main`, confirm repository ownership and provide `GITHUB_TOKEN` with release access:

```sh
npm run release
```

The command reruns validation before creating and pushing `v<version>` and creating a GitHub release with the reviewed notes and VSIX. It keeps the prepared version and changelog.

With the final Marketplace publisher and publishing credentials configured, publish that VSIX:

```sh
npm run release:marketplace
```

Publish only with explicit authorization. Verify installation and activation of the distributed package. If you change the candidate, rebuild and rerun the affected checks.
