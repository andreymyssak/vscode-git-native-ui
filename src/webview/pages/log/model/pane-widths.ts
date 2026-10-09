export function fitPaneWidths(
  viewportWidth: number,
  preferred: [number, number],
  collapsed = false,
): [number, number] {
  if (collapsed)
    return [
      30,
      Math.min(Math.max(220, preferred[1]), Math.max(220, viewportWidth - 280)),
    ];
  const left = Math.max(150, preferred[0]);
  const right = Math.max(220, preferred[1]);
  const available = Math.max(370, viewportWidth - 250);
  const excess = left + right - 370;
  const scale = excess > 0 ? Math.min(1, (available - 370) / excess) : 1;

  return [150 + (left - 150) * scale, 220 + (right - 220) * scale];
}
