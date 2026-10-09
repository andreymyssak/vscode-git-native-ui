import { expect, test } from 'vitest';
import type { Uri } from 'vscode';

import { ComparisonCache } from '../../src/extension/git/changes';
import { EmptyDocumentProvider } from '../../src/extension/native/empty-document';

test('empty document provider supplies an empty comparison side', () => {
  expect(
    new EmptyDocumentProvider().provideTextDocumentContent({
      scheme: 'git-native-ui-empty',
    } as Uri),
  ).toBe('');
});
test('101st comparison evicts oldest while access retains a recent comparison', () => {
  const cache = new ComparisonCache<number>();

  for (let i = 0; i < 100; i++) cache.set(String(i), i);
  expect(cache.get('0')).toBe(0);
  cache.set('100', 100);
  expect(cache.size).toBe(100);
  expect(cache.get('1')).toBe(undefined);
  expect(cache.get('0')).toBe(0);
});
