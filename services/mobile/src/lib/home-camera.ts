export type HomeCamera = { x: number; y: number; zoom: number; focusY?: number; focusX?: number; focusZ?: number };
export const defaultCamera: HomeCamera = { x: 0, y: 0, zoom: 1 };
// Front elevation, three-quarter view and raised roof view in the supplied references.
export const CAMERA_LIMITS = { x: [-35, 28], y: [-12, 13], zoom: [0.9, 1.18] } as const;
export function constrainCamera(camera: HomeCamera): HomeCamera {
  const bound = (value: number, low: number, high: number, fallback: number) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
  return { ...camera, x: bound(camera.x, ...CAMERA_LIMITS.x, 0), y: bound(camera.y, ...CAMERA_LIMITS.y, 0), zoom: bound(camera.zoom, ...CAMERA_LIMITS.zoom, 1) };
}

/** Camera moves opposite the pointer so the house follows the user's hand. */
export function dragHomeCamera(origin: HomeCamera, dx: number, dy: number): HomeCamera {
  return { ...constrainCamera({ ...origin, x: origin.x - dx / 3, y: origin.y + dy / 8 }), zoom: origin.zoom };
}
export function toggleHomeSelection<T extends string>(selected: T | undefined, next: T): T | undefined {
  return selected === next ? undefined : next;
}
