import { expect, test } from 'vitest';

import { planNavigation } from '../../src/extension/panel/navigation';
import type { ResolveResult } from '../../src/shared/model';

const target: ResolveResult = {
  kind: 'commit',
  commit: {
    sha: 'a'.repeat(40),
    parents: [],
    message: 'target',
    authorName: null,
    authorEmail: null,
    authorDate: null,
    commitDate: null,
  },
};

test('ref collision offers choice', () => {
  expect(
    planNavigation(
      { kind: 'choices', references: [] },
      { inQuery: false, inAll: false, scope: { kind: 'head' } },
    ).kind,
  ).toBe('choose-ref');
});
test('a target in the current query is revealed', () => {
  expect(
    planNavigation(target, {
      inQuery: true,
      inAll: true,
      scope: { kind: 'head' },
    }).kind,
  ).toBe('reveal');
});
test('outside All offers explicit commit scope', () => {
  const decision = planNavigation(target, {
    inQuery: false,
    inAll: false,
    scope: { kind: 'head' },
  });

  expect(decision.kind).toBe('offer-commit-history');
  expect(decision.scope).toStrictEqual({
    kind: 'commit',
    sha: target.commit.sha,
  });
});

test('a target in All offers to clear the active query', () => {
  expect(
    planNavigation(target, {
      inQuery: false,
      inAll: true,
      scope: { kind: 'head' },
    }),
  ).toStrictEqual({ kind: 'offer-clear', target, scope: { kind: 'all' } });
});
test('an unresolved target reports an error in the current scope', () => {
  const missing: ResolveResult = { kind: 'missing', message: 'Missing' };

  expect(
    planNavigation(missing, {
      inQuery: false,
      inAll: false,
      scope: { kind: 'head' },
    }),
  ).toStrictEqual({ kind: 'error', target: missing, scope: { kind: 'head' } });
});
