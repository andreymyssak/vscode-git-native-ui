import type { ReactNode } from 'react';
import { createContext, useEffect, useState } from 'react';

import type { FileIconTheme } from '@contracts/file-icons';

import type { BrowserBridge } from '../../api';

export const FileIconThemeContext = createContext<FileIconTheme | null>(null);

export function FileIconThemeProvider({
  bridge,
  children,
}: {
  bridge: BrowserBridge;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<FileIconTheme | null>(null);

  useEffect(() => {
    let current: HTMLLinkElement | null = null;
    let pending: HTMLLinkElement | null = null;
    let epoch = 0;
    const stop = bridge.subscribe(({ body }) => {
      if (body.kind !== 'file-icon-theme') return;
      const request = ++epoch;

      pending?.remove();
      pending = null;
      const apply = (
        link: HTMLLinkElement | null,
        value: FileIconTheme | null,
      ) => {
        if (request !== epoch) return;
        current?.remove();
        current = link;
        pending = null;
        setTheme(value);
      };

      if (!body.stylesheet) {
        apply(null, body.theme);

        return;
      }

      const link = document.createElement('link');

      link.rel = 'stylesheet';
      link.href = body.stylesheet;
      link.dataset.fileIconTheme = '';
      link.onload = () => apply(link, body.theme);
      link.onerror = () => {
        link.remove();
        apply(null, null);
      };

      pending = link;
      document.head.append(link);
    });

    return () => {
      epoch++;
      stop();
      pending?.remove();
      current?.remove();
    };
  }, [bridge]);

  return (
    <FileIconThemeContext.Provider value={theme}>
      {children}
    </FileIconThemeContext.Provider>
  );
}
