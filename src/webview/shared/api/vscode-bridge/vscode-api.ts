import type { BrowserBridge, WebviewApi } from './messages';
import { createBrowserBridge } from './messages';

declare function acquireVsCodeApi(): WebviewApi;
let bridge: BrowserBridge | undefined;

export function getVsCodeBridge(): BrowserBridge {
  bridge ??= createBrowserBridge(acquireVsCodeApi(), window);

  return bridge;
}
