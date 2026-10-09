import { assert, test } from 'vitest';

import { containsRoot, sameRoot } from '../../src/extension/git/paths';

test('drive letter case spaces and backslashes retain root identity', () => {
  assert.ok(
    sameRoot(
      'C:\\Fixture With Space\\linked',
      'c:/Fixture With Space/linked',
      'win32',
    ),
  );
  assert.ok(!sameRoot('C:\\one', 'C:\\two', 'win32'));
  assert.ok(!sameRoot('/Fixture', '/fixture', 'darwin'));
});
test('worktree containment respects path segments, drives and network roots', () => {
  assert.ok(containsRoot('/repo/linked', '/repo/linked/nested'));
  assert.ok(!containsRoot('/repo/linked', '/repo/linked-copy'));
  assert.ok(containsRoot('C:\\Repo\\Linked', 'c:/repo/linked/nested', 'win32'));
  assert.ok(!containsRoot('C:\\Repo', 'D:\\Repo', 'win32'));
  assert.ok(
    containsRoot(
      '\\\\server\\share\\repo',
      '\\\\SERVER\\share\\repo\\nested',
      'win32',
    ),
  );
  assert.ok(
    !containsRoot(
      '\\\\server\\share\\repo',
      '\\\\server\\other\\repo',
      'win32',
    ),
  );
});
