const positionedMenus = new WeakSet<MouseEvent>();

export function dispatchContextMenu(
  target: HTMLElement,
  x: number,
  y: number,
): void {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 2,
  });

  positionedMenus.add(event);
  target.dispatchEvent(event);
}

export function offsetPointerContextMenu(
  event: MouseEvent,
  target: HTMLElement,
): boolean {
  if (event.defaultPrevented || positionedMenus.has(event)) return false;
  event.preventDefault();
  dispatchContextMenu(target, event.clientX + 8, event.clientY + 8);

  return true;
}
