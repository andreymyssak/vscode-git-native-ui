import { expect, test } from 'vitest';

import type { GitAdapter } from '../../src/extension/git/adapter';
import type { ActionPrompts } from '../../src/extension/panel/actions';
import { PanelActions } from '../../src/extension/panel/actions';
import { QuerySession } from '../../src/extension/panel/queries';

for (const kind of ['merge-branch', 'rebase-branch'] as const) {
  for (const choice of ['apply', 'cancel', 'changed session'] as const) {
    test(`${kind} reviews the named direction and ${choice} keeps its owned target`, async (t) => {
      const session = new QuerySession();

      t.onTestFinished(() => session.dispose());
      const head = 'a'.repeat(40);
      const source = 'b'.repeat(40);

      session.begin('repo', 1);
      session.repositoryInfo = {
        id: 'repo',
        rootUri: 'file:///repo',
        label: 'Repo',
        branch: 'main',
        headSha: head,
      };
      session.refs.set('refs/heads/feature', {
        id: 'refs/heads/feature',
        name: 'feature',
        kind: 'local',
        sha: source,
        remote: null,
      });
      const prompts: ActionPrompts & {
        confirmBranchIntegration: (
          kind: string,
          current: string,
          selected: string,
        ) => Promise<boolean>;
      } = {
        confirmBranchIntegration: async (method, current, selected) => {
          expect(method).toBe(kind);
          expect(current).toBe('main');
          expect(selected).toBe('feature');
          if (choice === 'changed session') session.begin('other', 2);

          return choice !== 'cancel';
        },
      };
      const actions = new PanelActions({} as GitAdapter, session, prompts);
      const prepare = () =>
        actions.prepare(
          { kind, refId: 'refs/heads/feature' },
          { repositoryId: 'repo', generation: 1 },
        );

      if (choice === 'changed session')
        await expect(prepare()).rejects.toThrow(/changed/);
      else
        expect(await prepare()).toStrictEqual(
          choice === 'cancel'
            ? null
            : {
                kind,
                refId: 'refs/heads/feature',
                expectedSha: source,
                expectedBranch: 'main',
                expectedHeadSha: head,
              },
        );
    });
  }
}
