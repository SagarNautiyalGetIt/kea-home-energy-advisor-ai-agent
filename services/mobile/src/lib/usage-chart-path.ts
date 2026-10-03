export type UsageChartPoint = { x: number; y: number; available: boolean };

/** Keep calendar slots when either displayed series has readings. */
export function usageChartValues(values: (number | null)[], previous?: readonly (number | null)[]) {
  return values.some(value => value !== null) || previous?.some(value => value !== null) ? values : [];
}

/** A missing current reading must never erase an available comparison reading. */
export function usageBarReadings(current: UsageChartPoint, previous?: UsageChartPoint) {
  const readings: { series: 'current' | 'previous'; point: UsageChartPoint }[] = [];
  if (previous?.available) readings.push({ series: 'previous', point: previous });
  if (current.available) readings.push({ series: 'current', point: current });
  return readings;
}

/** Each missing slot ends the current path; curves must never bridge telemetry gaps. */
export function usageLinePath(points: readonly UsageChartPoint[]) {
  let path = '';
  let previous: UsageChartPoint | undefined;
  for (const point of points) {
    if (!point.available) { previous = undefined; continue; }
    if (!previous) path += ` M${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    else {
      const controlOffset = (point.x - previous.x) * 0.46;
      path += ` C${(previous.x + controlOffset).toFixed(1)} ${previous.y.toFixed(1)} ${(point.x - controlOffset).toFixed(1)} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    }
    previous = point;
  }
  return path.trim();
}

export function usageAreaPath(points: readonly UsageChartPoint[], baseline: number) {
  const segments: UsageChartPoint[][] = [];
  let segment: UsageChartPoint[] = [];
  for (const point of points) {
    if (point.available) segment.push(point);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return segments.filter(values => values.length > 1).map(values => `${usageLinePath(values)} L${values.at(-1)!.x.toFixed(1)} ${baseline.toFixed(1)} L${values[0]!.x.toFixed(1)} ${baseline.toFixed(1)} Z`).join(' ');
}
