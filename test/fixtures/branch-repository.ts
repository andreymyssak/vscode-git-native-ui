import type { SquashFixture } from './squash-repository';

/** Public Git API operations backed by the disposable repository. */
export function configureBranchRepository(fixture: SquashFixture) {
  const repository = fixture.access.repository('fixture');

  repository.getRefs = async () =>
    (
      await fixture.runGit([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
      ])
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, commit] = line.split(' ');

        return { type: 0 as const, name: name!.slice(11), commit: commit! };
      });
  repository.getBranch = async (name) => ({
    type: 0,
    name: name.replace('refs/heads/', ''),
    commit: (await fixture.runGit(['rev-parse', name])).trim(),
  });
  repository.deleteBranch = async (name, force) => {
    if (force !== false)
      throw new Error('Fixture refuses forced branch deletion.');
    await fixture.runGit(['branch', '-d', '--', name]);
  };

  repository.createBranch = async (name, checkout, sha) => {
    if (checkout !== false)
      throw new Error('Fixture refuses branch creation with checkout.');
    await fixture.runGit(['branch', '--', name, sha!]);
  };

  repository.setBranchUpstream = async (name, upstream) => {
    await fixture.runGit([
      'branch',
      `--set-upstream-to=${upstream}`,
      '--',
      name,
    ]);
  };

  return repository;
}
