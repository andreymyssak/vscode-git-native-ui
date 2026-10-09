import { useLayoutEffect } from 'react';

import type { ViewState } from '../model/state';

export function RenderMeasurement({ snapshot }: { snapshot: ViewState }) {
  'use no memo';
  // eslint-disable-next-line react-hooks/purity -- This clock affects only post-commit telemetry, never rendered output.
  const start = performance.now();

  useLayoutEffect(() => {
    performance.clearMeasures('git-native-ui.render');
    performance.measure('git-native-ui.render', {
      start,
      end: performance.now(),
    });
  }, [snapshot, start]);

  return null;
}
