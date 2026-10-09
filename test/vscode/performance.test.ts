import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';

import type { Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { createLargeHistory } from '../fixtures/large-history';
import { nativeBrowser } from '../fixtures/native-panel';

describe('large native history', () => {
  it('30k commits with merges keep 200-item pages, bounded rows and responsive loading', async () => {
    const fixture = await createLargeHistory();
    let adapter: GitAdapter | undefined;
    let frame: Frame | undefined;

    try {
      adapter = await createGitAdapter();

      const total = Number(
        (await fixture.runGit(['rev-list', '--count', 'HEAD'])).trim(),
      );

      assert.ok(total >= 30000);
      assert.ok(
        Number(
          (
            await fixture.runGit([
              'rev-list',
              '--count',
              '--min-parents=2',
              'HEAD',
            ])
          ).trim(),
        ) > 0,
      );
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(fixture.root));
      const id = vscode.Uri.file(fixture.root).toString();

      const start = performance.now();
      const first = await adapter.history(id, {
        scope: { kind: 'head' },
        text: '',
        cursor: null,
      });
      const gitPageMs = performance.now() - start;

      assert.equal(first.commits.length, 200);
      await vscode.commands.executeCommand('gitNativeUI.log.focus');
      const browser = await nativeBrowser();

      for (let attempt = 0; attempt < 100 && !frame; attempt++) {
        for (const page of browser.contexts().flatMap((c) => c.pages()))
          for (const candidate of page.frames())
            if (await candidate.locator('#branches').count()) frame = candidate;
        if (!frame) await new Promise((r) => setTimeout(r, 50));
      }

      assert.ok(frame);
      await expect(frame.locator('[data-commit-row]').first()).toHaveAttribute(
        'data-sha',
        first.commits[0]!.sha,
      );
      await frame.evaluate(() => {
        const times: number[] = [];
        const messages: unknown[] = [];

        Reflect.set(window, 'renderTimes', times);
        Reflect.set(window, 'historyMessages', messages);
        const recordMessage = (event: MessageEvent) => {
          const message = event.data as {
            generation?: number;
            requestId?: string;
            body?: {
              kind?: string;
              message?: string;
              page?: { commits: unknown[] };
              append?: boolean;
              anchor?: unknown;
              sha?: string | null;
            };
          };

          if (
            [
              'loading',
              'history',
              'selection',
              'history-settled',
              'error',
            ].includes(message.body?.kind ?? '')
          )
            messages.push({
              generation: message.generation,
              requestId: message.requestId,
              kind: message.body?.kind,
              count: message.body?.page?.commits.length,
              append: message.body?.append,
              anchor: message.body?.anchor,
              sha: message.body?.sha,
              error: message.body?.message,
            });
        };

        window.addEventListener('message', recordMessage);
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (entry.name === 'git-native-ui.render')
              times.push(entry.duration);
        });

        observer.observe({ entryTypes: ['measure'] });
        Reflect.set(window, 'stopPerformanceObservation', () => {
          window.removeEventListener('message', recordMessage);
          observer.disconnect();
        });
      });
      await expect(frame.locator('#status')).not.toContainText('Loading');
      await expect(frame.locator('#history-pane')).toHaveAttribute(
        'aria-busy',
        'false',
      );
      await expect(frame.locator('#history')).not.toHaveAttribute('inert', '');
      const content = frame.locator('[data-history-content]');

      await expect(content).toHaveCSS('height', `${200 * 22}px`);
      for (let index = 1; index < 10; index++) {
        await expect(frame.locator('#history-pane')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await expect(frame.locator('#history')).not.toHaveAttribute(
          'inert',
          '',
        );
        await frame.locator('#history').evaluate((node) => {
          node.scrollTop = node.scrollHeight;
          // Deliver the gesture before deliberately racing a native refresh.
          node.dispatchEvent(new Event('scroll'));
        });
        // A native read can refresh unchanged HEAD while the next page is pending.
        if (index === 1) await access.repository(id).status();
        await expect(content)
          .toHaveCSS('height', `${(index + 1) * 200 * 22}px`)
          .catch(async (error: unknown) => {
            await writeFile(
              '.artifacts/native-history-failure.json',
              JSON.stringify(
                await frame!.evaluate(() => ({
                  messages: Reflect.get(window, 'historyMessages'),
                  status: document.getElementById('status')?.textContent,
                  height: document
                    .querySelector('[data-history-content]')
                    ?.getBoundingClientRect().height,
                  scrollTop: document.getElementById('history')?.scrollTop,
                })),
                null,
                2,
              ),
            );
            throw error;
          });
      }

      const rows = await frame.locator('[data-commit-row]').count();

      assert.ok(rows <= 300);
      await frame
        .getByRole('searchbox', { name: 'Text or hash' })
        .fill('Large 10');
      const loading = await frame.evaluate(async () => {
        const start = performance.now();
        const input = document.getElementById('search') as HTMLInputElement;

        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );

        return {
          elapsed: performance.now() - start,
          text: document.getElementById('status')?.textContent,
        };
      });

      assert.ok(loading.elapsed <= 100);
      assert.ok(loading.text?.includes('Loading'));
      await expect(frame.locator('#status')).not.toContainText('Loading');
      const times = await frame.evaluate(
        () => Reflect.get(window, 'renderTimes') as number[],
      );

      assert.ok(times.length > 0, 'capture at least one post-data render');
      const maxRenderMs = Math.max(...times);

      assert.ok(maxRenderMs <= 100, `Post-data render ${maxRenderMs} ms`);
      await writeFile(
        '.artifacts/performance.json',
        JSON.stringify(
          {
            date: new Date().toISOString().slice(0, 10),
            os: platform(),
            release: release(),
            cpu: cpus()[0]?.model,
            vscode: vscode.version,
            node: process.versions.node,
            electron: process.versions.electron,
            totalCommits: total,
            firstPage: first.commits.length,
            tenPageMountedRows: rows,
            gitPageMs,
            loadingResponseMs: loading.elapsed,
            maxPostDataRenderMs: maxRenderMs,
          },
          null,
          2,
        ),
      );
    } finally {
      try {
        if (frame && !frame.isDetached()) {
          await frame.evaluate(() => {
            const stop = Reflect.get(window, 'stopPerformanceObservation') as
              (() => void) | undefined;

            stop?.();
            Reflect.deleteProperty(window, 'stopPerformanceObservation');
          });
          const search = frame.getByRole('searchbox', {
            name: 'Text or hash',
          });

          await search.fill('');
          await search.press('Enter');
          await expect(frame.locator('#history-pane')).toHaveAttribute(
            'aria-busy',
            'false',
          );
        }
      } finally {
        // The native driver owns the window and CDP lifetime; closing a connected
        // default context would also close its webview targets.
        adapter?.dispose();
        await fixture.dispose();
      }
    }
  });
});
