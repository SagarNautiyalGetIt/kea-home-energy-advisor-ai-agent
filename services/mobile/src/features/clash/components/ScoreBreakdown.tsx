import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { demoScoreParts, demoScoring, metricDetails, type DemoMetrics, type MetricKey } from '@/lib/clash-preview';
import { useAppTheme } from '@/theme';

const keys: MetricKey[] = ['conservation', 'ev', 'offPeak', 'solar'];
const icons = { conservation: 'flash-outline', ev: 'car-sport-outline', offPeak: 'time-outline', solar: 'sunny-outline' } as const;

function amount(key: MetricKey, metrics: DemoMetrics): string {
  switch (key) {
    case 'conservation': return `${metrics.conservedKwh} kWh · ${metrics.reductionPercent}% vs baseline`;
    case 'ev': return `${metrics.evAvoidedKg} kg CO₂e avoided · example`;
    case 'offPeak': return `$${metrics.offPeakSavingsNzd} saved · example`;
    case 'solar': return `${metrics.solarAvoidedKg} kg CO₂e avoided · example`;
  }
}

export function ScoreBreakdown({ metrics, selected, onSelect }: { metrics: DemoMetrics; selected: MetricKey; onSelect: (key: MetricKey) => void }) {
  const { colors } = useAppTheme();
  const parts = demoScoreParts(metrics);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>How the score adds up</Text>
      <Text style={[styles.caption, { color: colors.textMuted }]}>Four example categories, each with a different weight. Tap one to see what verified data it would need.</Text>
      {keys.map((key) => {
        const weight = demoScoring[key].weight;
        const active = selected === key;
        return (
          <Pressable
            accessibilityLabel={`${metricDetails[key].label}, ${amount(key, metrics)}, ${parts[key].toFixed(1)} of ${weight} demo points`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={key}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [styles.row, { borderColor: active ? '#606060' : colors.border, backgroundColor: active ? colors.surfaceRaised : colors.surface }, pressed && styles.pressed]}
          >
            <View style={styles.rowTop}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceRaised }]}><Ionicons color={colors.text} name={icons[key]} size={19} /></View>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowName, { color: colors.text }]}>{metricDetails[key].label}</Text>
                <Text style={[styles.amount, { color: colors.textMuted }]}>{amount(key, metrics)}</Text>
              </View>
              <Text style={[styles.points, { color: colors.text }]}>{parts[key].toFixed(1)}<Text style={[styles.max, { color: colors.textMuted }]}>/{weight}</Text></Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { width: `${Math.min(100, parts[key] / weight * 100)}%`, backgroundColor: colors.text }]} /></View>
          </Pressable>
        );
      })}
      <View style={[styles.method, { backgroundColor: colors.surfaceRaised }]}>
        <Text style={[styles.methodLabel, { color: colors.text }]}>HOW {metricDetails[selected].label.toUpperCase()} WOULD WORK</Text>
        <Text style={[styles.methodText, { color: colors.textMuted }]}>{metricDetails[selected].method}</Text>
      </View>
      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>Sample weights: conservation 35%, EV 20%, off-peak 25%, solar 20%. Production must account fairly for households without EV or solar. These rules are not approved.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, gap: 9 },
  title: { fontSize: 18, fontWeight: '800' },
  caption: { fontSize: 11, lineHeight: 16, marginBottom: 4 },
  row: { borderWidth: 1, borderRadius: 14, padding: 11, minHeight: 70 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1 },
  rowName: { fontSize: 12, fontWeight: '800' },
  amount: { fontSize: 10, marginTop: 3 },
  points: { fontSize: 13, fontWeight: '800' },
  max: { fontSize: 10, fontWeight: '500' },
  track: { height: 3, borderRadius: 3, marginTop: 9, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  method: { borderRadius: 13, padding: 12, marginTop: 2 },
  methodLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  methodText: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  disclaimer: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  pressed: { opacity: 0.75 },
});
