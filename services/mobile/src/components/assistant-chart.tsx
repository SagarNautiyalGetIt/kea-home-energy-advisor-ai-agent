import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import type { ChartEvent } from '@/lib/assistant-stream';
import { useAppTheme } from '@/theme';

const BLUE = '#38BDF8';
const BLUE_MUTED = '#164F69';

function formatValue(value: number, unit: ChartEvent['unit']): string {
  return unit === 'nzd' ? `$${value.toFixed(2)}` : `${value.toFixed(value < 10 ? 1 : 0)} kWh`;
}

/** Draw only the server's selected points; the API records the lookup behind the chart. */
export function AssistantChart({ spec }: { spec: ChartEvent | null }) {
  const { colors } = useAppTheme();
  if (!spec) return <Text style={[styles.unavailable, { color: colors.textMuted }]}>Chart unavailable for this answer.</Text>;

  const values = spec.points.map((point) => point.value);
  const ceiling = Math.max(...values.map(Math.abs), 0) || 1;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const range = high - low || 1;
  const points = spec.points.map((point, index) => ({
    x: 10 + (index / Math.max(1, spec.points.length - 1)) * 280,
    y: 110 - ((point.value - low) / range) * 94,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  return <View accessible accessibilityLabel={`${spec.title}. ${spec.points.map((point) => `${point.label}: ${formatValue(point.value, spec.unit)}`).join('; ')}.`} style={[styles.wrap, { borderTopColor: colors.border }]}>
    <Text style={[styles.title, { color: colors.text }]}>{spec.title}</Text>
    {spec.kind === 'line' ? <>
      <Svg height={126} viewBox="0 0 300 126" width="100%">
        <Line stroke={colors.border} strokeWidth={1} x1={10} x2={290} y1={110} y2={110} />
        <Path d={line} fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
      </Svg>
      <View style={styles.axis}><Text style={[styles.axisText, { color: colors.textMuted }]}>{spec.points[0]?.label}</Text><Text style={[styles.axisText, { color: colors.textMuted }]}>{spec.points.at(-1)?.label}</Text></View>
    </> : <View style={styles.bars}>
      {spec.points.map((point, index) => <View key={`${point.label}-${index}`} style={styles.barRow}>
        <View style={styles.barTop}><Text numberOfLines={2} style={[styles.label, { color: colors.textMuted }]}>{point.label}</Text><Text style={[styles.value, { color: colors.text }]}>{formatValue(point.value, spec.unit)}</Text></View>
        <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { width: `${Math.max(2, (Math.abs(point.value) / ceiling) * 100)}%`, backgroundColor: point.highlight ? BLUE : BLUE_MUTED }]} /></View>
      </View>)}
    </View>}
    {spec.caveat ? <Text style={[styles.note, { color: colors.textMuted }]}>{spec.caveat}</Text> : null}
    {spec.source ? <Text style={[styles.note, { color: colors.textMuted }]}>Source: {spec.source}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, borderTopWidth: 1, paddingTop: 12, gap: 8 },
  title: { fontSize: 12, fontWeight: '800', lineHeight: 17 },
  bars: { gap: 10 },
  barRow: { gap: 5 },
  barTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  label: { flex: 1, fontSize: 10, lineHeight: 14 },
  value: { fontSize: 10, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 9, lineHeight: 13 },
  note: { fontSize: 10, lineHeight: 15 },
  unavailable: { marginTop: 10, fontSize: 11, lineHeight: 16 },
});
