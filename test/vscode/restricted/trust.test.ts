import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { getGitApi } from '../../../src/extension/git/api';
import { PanelController } from '../../../src/extension/panel/controller';
import type { PanelBody } from '../../../src/shared/messages';

describe('restricted workspace', () => {
  it('untrusted native workspace blocks Git access and shows setup', async () => {
    assert.equal(vscode.workspace.isTrusted, false);
    await assert.rejects(() => getGitApi(), /Trust this workspace/);
    const messages: PanelBody[] = [];
    const controller = new PanelController({
      adapter: null,
      trusted: () => vscode.workspace.isTrusted,
      send: (message) => {
        messages.push(message.body);
      },
      openChange: async () => {
        throw new Error('Must not open');
      },
      pickRepository: async () => null,
      initialRepositoryId: null,
    });

    try {
      await controller.handle({
        requestId: 'trust',
        repositoryId: '',
        generation: 0,
        body: { kind: 'ready', savedRepositoryId: null },
      });
      assert.ok(
        messages.some(
          (message) =>
            message.kind === 'setup' && message.state === 'untrusted',
        ),
      );
    } finally {
      controller.dispose();
    }
  });
});
