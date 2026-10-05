export const HOME_MAX_RENDER_PIXELS = 1_200_000;

/** Adapt to orientation/window resizing without quadratic tablet buffer growth. */
export function homeRenderDpr(width: number, height: number, deviceDpr: number): number {
  if (![width, height, deviceDpr].every(value => Number.isFinite(value) && value > 0)) return 1;
  return Math.min(deviceDpr, 1.5, Math.sqrt(HOME_MAX_RENDER_PIXELS / (width * height)));
}

/** Expo GL ignores Fiber's dpr. Bound the native view itself, then scale visually. */
export function homeRenderSurface(width: number, height: number, deviceDpr: number, requestedDpr?: number) {
  if (![width, height, deviceDpr].every(value => Number.isFinite(value) && value > 0)) return null;
  const target = Math.min(homeRenderDpr(width, height, deviceDpr), requestedDpr && requestedDpr > 0 ? requestedDpr : Infinity);
  const renderWidth = Math.max(1, Math.floor(width * target)) / deviceDpr;
  const renderHeight = Math.max(1, Math.floor(height * target)) / deviceDpr;
  return { width: renderWidth, height: renderHeight, scaleX: width / renderWidth, scaleY: height / renderHeight };
}
