import { expect, test } from 'vitest';

import { classifySearch } from '../../src/shared/search';

test('only an entire seven to sixty-four character hex query searches hashes', () => {
  expect(classifySearch('abc1234')).toBe('hash-and-text');
  expect(classifySearch('prefix abc1234')).toBe('text');
  expect(classifySearch('abc123')).toBe('text');
  expect(classifySearch('a'.repeat(65))).toBe('text');
  expect(classifySearch('ABCD123')).toBe('hash-and-text');
});
