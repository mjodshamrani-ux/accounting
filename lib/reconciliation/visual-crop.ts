import type { VisualCell } from './visual-review.ts';
export type VisualBox = VisualCell['region'];
function dimensions(width: number, height: number) {
  if (
    ![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 4096)
  )
    throw new Error('Invalid crop dimensions');
}
/** Native integer coordinates; CSS scale and text direction cannot change them. */
export function cropBetween(
  a: readonly number[],
  b: readonly number[],
  width: number,
  height: number,
): VisualBox | null {
  dimensions(width, height);
  if (a.length !== 2 || b.length !== 2 || ![...a, ...b].every(Number.isFinite))
    return null;
  const bound = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const x0 = Math.floor(bound(Math.min(a[0], b[0]), width)),
    y0 = Math.floor(bound(Math.min(a[1], b[1]), height));
  const x1 = Math.ceil(bound(Math.max(a[0], b[0]), width)),
    y1 = Math.ceil(bound(Math.max(a[1], b[1]), height));
  return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null;
}
export function moveCrop(
  box: VisualBox,
  key: string,
  resize: boolean,
  width: number,
  height: number,
): VisualBox {
  dimensions(width, height);
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key))
    return box;
  const dx = key === 'ArrowLeft' ? -8 : key === 'ArrowRight' ? 8 : 0;
  const dy = key === 'ArrowUp' ? -8 : key === 'ArrowDown' ? 8 : 0;
  if (resize)
    return {
      ...box,
      x1: Math.min(width, Math.max(box.x0 + 1, box.x1 + dx)),
      y1: Math.min(height, Math.max(box.y0 + 1, box.y1 + dy)),
    };
  const x = Math.min(width - box.x1, Math.max(-box.x0, dx));
  const y = Math.min(height - box.y1, Math.max(-box.y0, dy));
  return { x0: box.x0 + x, y0: box.y0 + y, x1: box.x1 + x, y1: box.y1 + y };
}
