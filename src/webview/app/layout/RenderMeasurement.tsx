import { useLayoutEffect } from 'react';

import { RENDER_MEASUREMENT } from '@contracts/extension-identity';

import type { ViewState } from '../model/state';

export function RenderMeasurement({ snapshot }: { snapshot: ViewState }) {
  'use no memo';
  // eslint-disable-next-line react-hooks/purity -- This clock affects only post-commit telemetry, never rendered output.
  const start = performance.now();

  useLayoutEffect(() => {
    performance.clearMeasures(RENDER_MEASUREMENT);
    performance.measure(RENDER_MEASUREMENT, {
      start,
      end: performance.now(),
    });
  }, [snapshot, start]);

  return null;
}
