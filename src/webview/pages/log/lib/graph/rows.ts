import {
  renderSCMHistoryItemGraph,
  SWIMLANE_WIDTH,
} from '../../../../../vendor/vscode-graph/graph';
import type { GraphRow } from './adapter';

export function renderGraph(row: GraphRow): SVGElement {
  const svg = renderSCMHistoryItemGraph(row.viewModel);

  svg.setAttribute('aria-hidden', 'true');

  return svg;
}

export function graphWidth(rows: GraphRow[]): number {
  return (
    SWIMLANE_WIDTH *
    (Math.max(
      1,
      ...rows.map((row) =>
        Math.max(
          row.viewModel.inputSwimlanes.length,
          row.viewModel.outputSwimlanes.length,
        ),
      ),
    ) +
      1)
  );
}
