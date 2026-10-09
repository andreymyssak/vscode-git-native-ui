import { expect, test, vi } from 'vitest';

import { recoverBrowserNavigation } from '../fixtures/browser-navigation';

test('a successful navigation returns its response without a recovery warning', async () => {
  const navigate = vi.fn(async () => 'loaded');
  const report = vi.fn();

  await expect(recoverBrowserNavigation({ navigate, report })).resolves.toBe(
    'loaded',
  );
  expect(report).not.toHaveBeenCalled();
});

test('one socket allocation failure is reported and the navigation can recover', async () => {
  const error = new Error('page.goto: net::ERR_NO_BUFFER_SPACE');
  const navigate = vi.fn(async () => 'loaded').mockRejectedValueOnce(error);
  const report = vi.fn();

  await expect(recoverBrowserNavigation({ navigate, report })).resolves.toBe(
    'loaded',
  );
  expect(report).toHaveBeenCalledExactlyOnceWith(error);
});

test('a second socket allocation failure propagates without a third attempt', async () => {
  const error = new Error('page.goto: net::ERR_NO_BUFFER_SPACE');
  const navigate = vi
    .fn(async () => 'loaded')
    .mockRejectedValueOnce(error)
    .mockRejectedValueOnce(error);

  await expect(
    recoverBrowserNavigation({ navigate, report: vi.fn() }),
  ).rejects.toBe(error);
  expect(navigate).toHaveBeenCalledTimes(2);
});

test.each([
  new Error('page.goto: net::ERR_CONNECTION_REFUSED'),
  new Error('expect(locator).toBeVisible() failed'),
  'net::ERR_NO_BUFFER_SPACE',
])('other failures propagate without retry: %s', async (error) => {
  const navigate = vi.fn(async () => 'loaded').mockRejectedValueOnce(error);
  const report = vi.fn();

  await expect(recoverBrowserNavigation({ navigate, report })).rejects.toBe(
    error,
  );
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(report).not.toHaveBeenCalled();
});
