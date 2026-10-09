import type { GitRef, GitRepository } from './api';

/** Status also fires for editor/index activity; only history metadata revokes a query. */
export function historyChangeFilter(
  repository: GitRepository,
  changed: () => void,
): { check(): Promise<void>; settled(): Promise<void> } {
  const ref = (value: GitRef | undefined) =>
    value
      ? [value.type, value.name, value.commit, value.remote, value.upstream]
      : null;
  const snapshot = () => {
    const metadata = {
      head: ref(repository.state.HEAD),
      worktrees: [...repository.state.worktrees].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      remotes: [...repository.state.remotes].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };

    // state.refs is deprecated and returns an empty array in the supported VS Code.
    return repository.getRefs({}).then(
      (refs) =>
        JSON.stringify({
          ...metadata,
          refs: refs
            .map(ref)
            .sort((left, right) =>
              JSON.stringify(left).localeCompare(JSON.stringify(right)),
            ),
        }),
      () => null,
    );
  };

  let previous = snapshot();
  let pending = previous.then(() => {});

  return {
    settled: () => pending,
    check() {
      const current = snapshot();
      const before = previous;

      previous = current;
      pending = pending.then(async () => {
        const [oldKey, newKey] = await Promise.all([before, current]);

        if (oldKey === null || newKey === null || oldKey !== newKey) changed();
      });

      return pending;
    },
  };
}
