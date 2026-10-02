export type HomeCamera = { x: number; y: number; zoom: number };
export const defaultCamera: HomeCamera = { x: 0, y: 0, zoom: 1 };
export function constrainCamera(camera: HomeCamera): HomeCamera {
  const bound = (value: number, low: number, high: number, fallback: number) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
  return { x: bound(camera.x, -12, 12, 0), y: bound(camera.y, -9, 9, 0), zoom: bound(camera.zoom, 0.9, 1.45, 1) };
}
