import { expect, test } from 'vitest';

import { a, b, fixture } from '../fixtures/controller';

for (const replacement of [
  'file',
  'regular',
  'commit',
  'refresh',
  'repository',
  'dispose',
  'trust',
] as const) {
  test(`a deferred file preview cannot open after a newer ${replacement} intent`, async () => {
    const opened: {
      fileId: string;
      preview: boolean;
    }[] = [];
    let resume!: () => void;
    let started!: () => void;
    let trusted = true;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const opening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { controller, adapter, request } = fixture(true, true, {
      trusted: () => trusted,
      openChange: async (_id, handle, preview, current) => {
        started();
        await gate;
        if (current()) opened.push({ fileId: handle.file.id, preview });
      },
    });

    adapter.changes = async () =>
      ['first', 'second'].map((id) => ({
        id,
        status: 'modified',
        oldPath: `${id}.txt`,
        newPath: `${id}.txt`,
      }));
    await controller.handle(
      request({ kind: 'ready', savedRepositoryId: null }),
    );
    await controller.handle(request({ kind: 'select-commit', sha: a }));
    const first = controller.handle(
      request({ kind: 'open-file', fileId: 'first', preview: true }),
    );

    await opening;
    let next: Promise<void> | undefined;

    switch (replacement) {
      case 'file':
      case 'regular':
        next = controller.handle(
          request({
            kind: 'open-file',
            fileId: replacement === 'file' ? 'second' : 'first',
            preview: replacement === 'file',
          }),
        );
        break;
      case 'commit':
        await controller.handle(request({ kind: 'select-commit', sha: b }));
        break;
      case 'refresh':
        await controller.handle(request({ kind: 'refresh' }));
        break;
      case 'repository':
        await controller.selectRepository('two');
        break;
      case 'dispose':
        controller.dispose();
        break;
      case 'trust':
        trusted = false;
        break;
    }

    resume();
    await Promise.all([first, next]);
    expect(opened).toStrictEqual(
      replacement === 'file'
        ? [{ fileId: 'second', preview: true }]
        : replacement === 'regular'
          ? [{ fileId: 'first', preview: false }]
          : [],
    );
    controller.dispose();
  });
}
