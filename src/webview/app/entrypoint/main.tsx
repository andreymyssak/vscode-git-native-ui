import '@vscode/codicons/dist/codicon.css';
import '../styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { getVsCodeBridge } from '@webview/shared/api';

import { App } from '../layout/App';

const mount = document.getElementById('app');

if (!mount) throw new Error('Git Native UI root is unavailable.');
const bridge = getVsCodeBridge();
const root = createRoot(mount);

root.render(
  __DEV__ ? (
    <StrictMode>
      <App bridge={bridge} />
    </StrictMode>
  ) : (
    <App bridge={bridge} />
  ),
);

function teardown(event: PageTransitionEvent) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', teardown);
  root.unmount();
  bridge.dispose();
}

window.addEventListener('pagehide', teardown);
