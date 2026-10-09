export type MetadataWidths = [number, number] | null;
export type Columns = [number, number, number];
const maximumMetadataWidth = 10000;

export function fitColumns(
  available: number,
  minimum: number,
  preferred: MetadataWidths,
  visible = { author: true, date: true },
): Columns {
  const authorMinimum = visible.author ? 65 : 0;
  const dateMinimum = visible.date ? 80 : 0;
  const width = Math.max(available, minimum + authorMinimum + dateMinimum);
  const author = visible.author
    ? Math.min(
        maximumMetadataWidth,
        Math.max(65, preferred?.[0] ?? width * 0.18),
      )
    : 0;
  const date = visible.date
    ? Math.min(
        maximumMetadataWidth,
        Math.max(80, preferred?.[1] ?? Math.max(130, width * 0.22)),
      )
    : 0;
  const excess = author + date - authorMinimum - dateMinimum;
  const scale =
    excess > 0
      ? Math.min(1, (width - minimum - authorMinimum - dateMinimum) / excess)
      : 1;
  const fittedAuthor = authorMinimum + (author - authorMinimum) * scale;
  const fittedDate = dateMinimum + (date - dateMinimum) * scale;

  return [width - fittedAuthor - fittedDate, fittedAuthor, fittedDate];
}

export type ColumnWidths = [number, number, number, number];
export type ColumnIndex = 0 | 1 | 2 | 3;

export function resizeVisibleColumns(
  widths: ColumnWidths,
  minimum: number,
  left: ColumnIndex,
  right: ColumnIndex,
  delta: number,
): ColumnWidths {
  const minima = [minimum, 65, 80, 65] as const;
  const leftMaximum = left === 0 ? Infinity : maximumMetadataWidth;
  const movement = Math.max(
    minima[left] - widths[left],
    widths[right] - maximumMetadataWidth,
    Math.min(widths[right] - minima[right], leftMaximum - widths[left], delta),
  );
  const next: ColumnWidths = [...widths];

  next[left] += movement;
  next[right] -= movement;

  return next;
}
