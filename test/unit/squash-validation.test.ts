import { expect, test } from 'vitest';

import {
  supportsSquashGit,
  validateSquashMessage,
} from '../../src/extension/git/squash';

test('squash requires a verified stable Git 2.47 or newer', () => {
  for (const [version, expected] of [
    ['2.46.9', false],
    ['2.47.0', true],
    ['2.47.1.windows.1', true],
    ['git version 2.47.1', true],
    ['2.48.0', true],
    ['3.0.0', true],
    ['2.47.0-rc1', false],
    ['not a version', false],
    ['prefix 2.47.1', false],
    ['', false],
  ] as const) {
    expect(supportsSquashGit(version), version).toBe(expected);
  }
});
test('squash message limit uses UTF-8 bytes including the exact boundary', () => {
  const boundary = 'é'.repeat(524288);

  expect(Buffer.byteLength(boundary, 'utf8')).toBe(1048576);
  expect(() => validateSquashMessage(boundary)).not.toThrow();
  expect(() => validateSquashMessage(boundary + 'é')).toThrow(
    /1 MiB|large|size/i,
  );
  expect(() => validateSquashMessage('a'.repeat(1048577))).toThrow(
    /1 MiB|large|size/i,
  );
});
test('squash messages accept literal multiline Unicode without trimming the draft', () => {
  expect(() =>
    validateSquashMessage("  Combined ü\n\nBody $() 'quoted'\n  "),
  ).not.toThrow();
});
test('blank or NUL squash messages reject before an operation can begin', () => {
  for (const message of ['', ' \n\t ', 'Message\0body']) {
    expect(() => validateSquashMessage(message)).toThrow(/blank|empty|NUL/i);
  }
});
