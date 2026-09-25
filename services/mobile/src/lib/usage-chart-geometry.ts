export type ChartPoint = { x: number; y: number };

/** Break the stroke at every missing meter day instead of drawing through the gap. */
export function pathFor(points: readonly (ChartPoint | null)[]) {
  let path = '';
  let previous: ChartPoint | null = null;
  points.forEach((point) => {
    if (!point) { previous = null; return; }
    if (!previous) { path += `M${point.x.toFixed(1)} ${point.y.toFixed(1)}`; previous = point; return; }
    const controlOffset: number = (point.x - previous.x) * 0.46;
    path += ` C${(previous.x + controlOffset).toFixed(1)} ${previous.y.toFixed(1)} ${(point.x - controlOffset).toFixed(1)} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    previous = point;
  });
  return path;
}

export function pathLength(points: readonly (ChartPoint | null)[]) {
  return Math.max(1, points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return point && previous ? total + Math.hypot(point.x - previous.x, point.y - previous.y) : total;
  }, 0));
}
