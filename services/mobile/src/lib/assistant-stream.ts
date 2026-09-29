/** Parse the SSE wire format without depending on React Native's XHR implementation. */
export type AssistantFrame = { event: string; payload: unknown };

export type ChartPoint = { label: string; value: number; highlight: boolean };
export type ChartEvent = {
  kind: 'bar' | 'line';
  title: string;
  unit: 'nzd' | 'kwh';
  points: ChartPoint[];
  caveat: string | null;
  source: string | null;
};

/** XHR's responseText is cumulative; return the offset after the last complete frame. */
export function parseSseFrames(buffer: string, offset: number): { frames: AssistantFrame[]; offset: number } {
  const frames: AssistantFrame[] = [];
  const separator = /\r?\n\r?\n/g;
  separator.lastIndex = offset;
  let consumed = offset;
  let boundary: RegExpExecArray | null;
  while ((boundary = separator.exec(buffer)) !== null) {
    const raw = buffer.slice(consumed, boundary.index);
    consumed = separator.lastIndex;
    let event = '';
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!event || !data.length) continue;
    try {
      frames.push({ event, payload: JSON.parse(data.join('\n')) as unknown });
    } catch {
      // A malformed frame must not turn a later valid `done` into a silent timeout.
    }
  }
  return { frames, offset: consumed };
}

/** Accept only numbers and labels supplied by the server's recorded lookup. */
export function parseChartEvent(raw: unknown): ChartEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const chart = raw as Record<string, unknown>;
  if ((chart.kind !== 'bar' && chart.kind !== 'line') ||
      (chart.unit !== 'nzd' && chart.unit !== 'kwh') ||
      typeof chart.title !== 'string' || !chart.title.trim() ||
      !Array.isArray(chart.points) || !chart.points.length || chart.points.length > 64) return null;
  const points: ChartPoint[] = [];
  for (const rawPoint of chart.points) {
    if (!rawPoint || typeof rawPoint !== 'object') return null;
    const point = rawPoint as Record<string, unknown>;
    if (typeof point.label !== 'string' || !point.label.trim() ||
        typeof point.value !== 'number' || !Number.isFinite(point.value) ||
        typeof point.highlight !== 'boolean') return null;
    points.push({ label: point.label, value: point.value, highlight: point.highlight });
  }
  if (chart.caveat != null && typeof chart.caveat !== 'string') return null;
  if (chart.source != null && typeof chart.source !== 'string') return null;
  return {
    kind: chart.kind,
    title: chart.title,
    unit: chart.unit,
    points,
    caveat: (chart.caveat as string | null | undefined) ?? null,
    source: (chart.source as string | null | undefined) ?? null,
  };
}
