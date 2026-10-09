import { expect, test } from '../fixtures/browser';

test('compiled React components isolate CSS module class names', async ({
  page,
}) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/react-probe.html');
  await expect(page.locator('[data-probe="first"]')).toHaveCSS(
    'color',
    'rgb(11, 22, 33)',
  );
  await expect(page.locator('[data-probe="second"]')).toHaveCSS(
    'color',
    'rgb(44, 55, 66)',
  );
  expect(errors).toEqual([]);
});

test('the production compiler retains derived options during unrelated updates', async ({
  page,
}) => {
  await page.goto('/react-probe.html');
  const changes = page.getByLabel('Derived options changes');

  await expect(changes).toHaveText('1');
  await page.getByRole('button', { name: 'Update unrelated state' }).click();
  await expect(page.getByText('Updates: 1', { exact: true })).toBeVisible();
  await expect(changes).toHaveText('1');
});
