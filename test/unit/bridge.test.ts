import { describe, expect, onTestFinished, test } from 'vitest';

import type {
  PanelBody,
  Request,
  RequestBody,
  Result,
} from '../../src/shared/messages';
import { createBrowserBridge } from '../../src/webview/shared/api/vscode-bridge';

function fixture(synchronous = false) {
  const target = new EventTarget();
  const requests: Request<RequestBody>[] = [];
  const received: Result<PanelBody>[] = [];
  const response: Result<PanelBody> = {
    requestId: '1',
    repositoryId: '',
    generation: 0,
    body: { kind: 'notice', message: 'First response' },
  };
  const bridge = createBrowserBridge(
    {
      postMessage(request) {
        requests.push(request);
        if (synchronous)
          target.dispatchEvent(new MessageEvent('message', { data: response }));
      },
      getState: () => null,
      setState: () => undefined,
    },
    target,
  );

  onTestFinished(() => bridge.dispose());

  return { bridge, target, requests, received, response };
}

describe('document message bridge', () => {
  test.each([
    null,
    'not a response',
    {
      requestId: '1',
      repositoryId: '',
      generation: -1,
      body: { kind: 'notice', message: 'Invalid generation' },
    },
    {
      requestId: '1',
      repositoryId: '',
      generation: 0,
      body: { kind: 'notice', message: 3 },
    },
    {
      requestId: '1',
      repositoryId: '',
      generation: 0,
      body: {
        kind: 'details',
        commit: {
          sha: 'a'.repeat(40),
          parents: [],
          message: 'Missing identity fields',
        },
      },
    },
    {
      requestId: '1',
      repositoryId: '',
      generation: 0,
      body: { kind: 'operation', result: { kind: 'conflict', backend: 'cli' } },
    },
    {
      requestId: '1',
      repositoryId: '',
      generation: 0,
      body: { kind: 'worktrees', worktrees: [{ id: 'one' }] },
    },
    {
      requestId: '1',
      repositoryId: '',
      generation: 0,
      body: { kind: 'future-message' },
    },
  ])('ignores malformed host responses without delivering them: %j', (data) => {
    const { bridge, target, received, response } = fixture();

    bridge.subscribe((message) => received.push(message));
    target.dispatchEvent(new MessageEvent('message', { data }));
    target.dispatchEvent(new MessageEvent('message', { data: response }));
    expect(received).toEqual([response]);
  });

  test('ready receives a synchronous first response and runs once', () => {
    const { bridge, requests, received } = fixture(true);

    bridge.subscribe((message) => received.push(message));
    bridge.ready('saved-root');
    bridge.ready('other-root');
    expect(requests).toEqual([
      {
        requestId: '1',
        repositoryId: '',
        generation: 0,
        body: { kind: 'ready', savedRepositoryId: 'saved-root' },
      },
    ]);
    expect(received).toHaveLength(1);
  });

  test('ready requires a subscriber before sending', () => {
    const { bridge, requests } = fixture();

    expect(() => bridge.ready(null)).toThrow(/subscrib/i);
    expect(requests).toHaveLength(0);
    bridge.subscribe(() => undefined);
    bridge.ready(null);
    expect(requests).toHaveLength(1);
  });

  test('subscriptions clean up without duplicating delivery', () => {
    const { bridge, target, received, response } = fixture();
    const off = bridge.subscribe((message) => received.push(message));

    off();
    bridge.subscribe((message) => received.push(message));
    target.dispatchEvent(new MessageEvent('message', { data: response }));
    expect(received).toEqual([response]);
    bridge.dispose();
    target.dispatchEvent(new MessageEvent('message', { data: response }));
    expect(received).toHaveLength(1);
  });

  test('request context uses supplied identity and increasing IDs', () => {
    const { bridge, requests } = fixture();

    const firstId = bridge.send(
      { kind: 'refresh' },
      { repositoryId: 'one', generation: 6 },
    );

    expect(firstId).toBe(requests[0]?.requestId);
    const secondId = bridge.send(
      { kind: 'select-commit', sha: 'b'.repeat(40) },
      { repositoryId: 'two', generation: 7 },
    );

    expect(secondId).toBe(requests[1]?.requestId);
    expect(secondId).not.toBe(firstId);
    expect(requests[1]).toEqual({
      requestId: '2',
      repositoryId: 'two',
      generation: 7,
      body: { kind: 'select-commit', sha: 'b'.repeat(40) },
    });
  });

  test('generic ready cannot bypass the document guard', () => {
    const { bridge, requests } = fixture();

    bridge.subscribe(() => undefined);
    bridge.send(
      { kind: 'ready', savedRepositoryId: null },
      { repositoryId: 'two', generation: 7 },
    );
    bridge.ready('one');
    expect(requests).toEqual([
      {
        requestId: '1',
        repositoryId: '',
        generation: 0,
        body: { kind: 'ready', savedRepositoryId: null },
      },
    ]);
  });
});
