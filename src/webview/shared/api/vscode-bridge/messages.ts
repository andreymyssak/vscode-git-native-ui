import type {
  PanelBody,
  Request,
  RequestBody,
  Result,
} from '@contracts/messages';
import type { RestorableView } from '@contracts/model';
import { parsePanelResult } from '@contracts/panel-result';

export type MessageContext = Pick<
  Request<RequestBody>,
  'repositoryId' | 'generation'
>;
export interface WebviewApi {
  postMessage(message: Request<RequestBody>): void;
  getState(): unknown;
  setState(value: unknown): void;
}
export interface BrowserBridge {
  send(body: RequestBody, context: MessageContext): string;
  subscribe(listener: (message: Result<PanelBody>) => void): () => void;
  ready(savedRepositoryId: string | null): void;
  getState(): unknown;
  setState(value: RestorableView): void;
  dispose(): void;
}

export function createBrowserBridge(
  api: WebviewApi,
  target: EventTarget,
): BrowserBridge {
  const listeners = new Set<(message: Result<PanelBody>) => void>();
  let requestId = 0;
  let readyRequestId: string | null = null;
  let disposed = false;
  const receive = (event: Event) => {
    if (!(event instanceof MessageEvent)) return;
    const data: unknown = event.data;
    const message = parsePanelResult(data);

    if (!message) return;
    for (const listener of listeners) listener(message);
  };

  target.addEventListener('message', receive);
  const ensureActive = () => {
    if (disposed) throw new Error('The webview bridge is disposed.');
  };

  const ready = (savedRepositoryId: string | null) => {
    ensureActive();
    if (readyRequestId) return readyRequestId;
    if (!listeners.size) throw new Error('Subscribe before sending ready.');
    readyRequestId = String(++requestId);
    api.postMessage({
      requestId: readyRequestId,
      repositoryId: '',
      generation: 0,
      body: { kind: 'ready', savedRepositoryId },
    });

    return readyRequestId;
  };

  return {
    send(body, context) {
      ensureActive();
      if (body.kind === 'ready') return ready(body.savedRepositoryId);
      const id = String(++requestId);

      api.postMessage({ requestId: id, ...context, body });

      return id;
    },
    subscribe(listener) {
      ensureActive();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    ready,
    getState: () => api.getState(),
    setState: (value) => api.setState(value),
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('message', receive);
      listeners.clear();
    },
  };
}
