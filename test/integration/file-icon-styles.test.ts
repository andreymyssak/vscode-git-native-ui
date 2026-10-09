import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assert, expect, test } from 'vitest';

import { FileIconSession } from '../../src/extension/panel/file-icon-session';
import { FileIconStyles } from '../../src/extension/panel/file-icon-styles';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });

  return { promise, resolve };
}

test('live theme stylesheet storage retains only the two latest saved files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-native-ui-icon-styles-'));
  const styles = new FileIconStyles({
    write: (name, css) => writeFile(join(root, name), css),
    remove: (name) => rm(join(root, name), { force: true }),
  });

  try {
    for (const name of ['first', 'second', 'third']) {
      const generation = styles.begin();
      const file = await styles.save(
        generation,
        'git-file-theme-' + name,
        'span{}',
      );

      assert.ok(file);
      await styles.prune();
    }

    expect((await readdir(root)).sort()).toStrictEqual([
      'git-file-theme-second.css',
      'git-file-theme-third.css',
    ]);
    await styles.dispose();
    expect(await readdir(root)).toStrictEqual([]);
  } finally {
    await styles.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
test('a late stylesheet write is deleted after a newer theme starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-native-ui-icon-styles-'));
  let finish: (() => void) | undefined;
  const styles = new FileIconStyles({
    write: async (name, css) => {
      if (name.endsWith('old.css'))
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      await writeFile(join(root, name), css);
    },
    remove: (name) => rm(join(root, name), { force: true }),
  });
  const old = styles.save(styles.begin(), 'git-file-theme-old', 'old{}');

  try {
    const latest = await styles.save(
      styles.begin(),
      'git-file-theme-new',
      'new{}',
    );

    assert.ok(latest);
    await styles.prune();
    finish!();
    expect(await old).toBe(null);
    expect(await readdir(root)).toStrictEqual(['git-file-theme-new.css']);
    await styles.dispose();
  } finally {
    finish?.();
    await Promise.allSettled([old]);
    await styles.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
test('an older pending publication cannot delete the newer stylesheet awaiting delivery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-native-ui-icon-styles-'));
  const styles = new FileIconStyles({
    write: (name, css) => writeFile(join(root, name), css),
    remove: (name) => rm(join(root, name), { force: true }),
  });
  const oldStarted = deferred();
  const latestStarted = deferred();
  const oldDelivery = deferred();
  const latestDelivery = deferred();
  let sequence = 0;
  const session = new FileIconSession({
    load: async () =>
      styles.save(styles.begin(), `git-file-theme-${++sequence}`, 'span{}'),
    publish: async (name) => {
      if (name === 'git-file-theme-1.css') {
        oldStarted.resolve();
        await oldDelivery.promise;
      } else {
        latestStarted.resolve();
        await latestDelivery.promise;
      }

      await styles.prune();
    },
  });

  let old: Promise<void> | undefined = undefined;
  let latest: Promise<void> | undefined = undefined;

  t.onTestFinished(async () => {
    oldDelivery.resolve();
    latestDelivery.resolve();
    await Promise.allSettled([old, latest]);
    session.dispose();
    await styles.dispose();
    await rm(root, { recursive: true, force: true });
  });
  session.ready();
  old = session.refresh();

  await oldStarted.promise;
  latest = session.refresh();

  await latestStarted.promise;
  try {
    oldDelivery.resolve();
    await old;
    expect((await readdir(root)).sort()).toStrictEqual([
      'git-file-theme-1.css',
      'git-file-theme-2.css',
    ]);
    latestDelivery.resolve();
    await latest;
    expect((await readdir(root)).sort()).toStrictEqual([
      'git-file-theme-1.css',
      'git-file-theme-2.css',
    ]);
  } finally {
    oldDelivery.resolve();
    latestDelivery.resolve();
    await Promise.allSettled([old, latest]);
    session.dispose();
    await styles.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
