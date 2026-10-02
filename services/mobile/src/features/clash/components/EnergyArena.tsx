import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { demoScoreParts, demoScoring, metricDetails, type DemoMetrics, type MetricKey } from '@/lib/clash-preview';
import { useAppTheme } from '@/theme';

const columns: { key: MetricKey; x: number; baseY: number; glyph: string }[] = [
  { key: 'ev', x: 104, baseY: 112, glyph: 'EV' },
  { key: 'solar', x: 201, baseY: 112, glyph: 'SOL' },
  { key: 'conservation', x: 92, baseY: 171, glyph: 'USE' },
  { key: 'offPeak', x: 206, baseY: 171, glyph: 'OFF' },
];

function Pillar({ x, baseY, height, glyph, selected, tint, onPress }: { x: number; baseY: number; height: number; glyph: string; selected: boolean; tint: string; onPress: () => void }) {
  const topY = baseY - height - (selected ? 5 : 0);
  const bottomY = baseY - (selected ? 5 : 0);
  return (
    <G onPress={onPress}>
      <Polygon fill={tint} fillOpacity={0.65} points={`${x - 23},${topY} ${x},${topY + 11} ${x},${bottomY + 11} ${x - 23},${bottomY}`} />
      <Polygon fill={tint} fillOpacity={0.4} points={`${x},${topY + 11} ${x + 23},${topY} ${x + 23},${bottomY} ${x},${bottomY + 11}`} />
      <Polygon fill={tint} points={`${x},${topY - 11} ${x + 23},${topY} ${x},${topY + 11} ${x - 23},${topY}`} stroke={tint} strokeWidth={selected ? 2 : 1} />
      <SvgText fill="#171717" fontSize={glyph.length > 1 ? 8 : 10} fontWeight="800" textAnchor="middle" x={x} y={topY + 3}>{glyph}</SvgText>
    </G>
  );
}

export function EnergyArena({ metrics, selected, onSelect }: { metrics: DemoMetrics; selected: MetricKey; onSelect: (key: MetricKey) => void }) {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const tints = { ev: colors.icons.info, solar: colors.icons.money, conservation: colors.icons.success, offPeak: colors.icons.warm };
  const parts = demoScoreParts(metrics);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      if (reducedMotion) return;
      tiltX.value = Math.max(-9, Math.min(9, -event.translationY * 0.09));
      tiltY.value = Math.max(-12, Math.min(12, event.translationX * 0.11));
    })
    .onEnd(() => {
      tiltX.value = reducedMotion ? 0 : withTiming(0, { duration: 260 });
      tiltY.value = reducedMotion ? 0 : withTiming(0, { duration: 260 });
    });
  const tiltStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 700 }, { rotateX: `${tiltX.value}deg` }, { rotateY: `${tiltY.value}deg` }] }));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.heading}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>The score arena</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>Tap a pillar · drag sideways to tilt</Text>
        </View>
        <Text style={[styles.demo, { color: colors.textMuted }]}>3D DEMO</Text>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View accessibilityLabel="Interactive isometric energy score board. Use the score categories below for accessible details." accessibilityRole="image" style={[styles.boardFrame, { backgroundColor: colors.surfaceRaised }, tiltStyle]}>
          <Svg height="100%" viewBox="0 0 300 245" width="100%">
            <Polygon fill={colors.border} points="15,105 150,211 150,230 15,124" />
            <Polygon fill={colors.border} points="150,211 285,105 285,124 150,230" />
            <Polygon fill={colors.surface} points="150,29 285,105 150,211 15,105" stroke={colors.border} strokeWidth="1.5" />
            <Polygon fill="none" points="150,47 265,108 150,194 35,108" stroke={colors.border} strokeWidth="1" />
            {columns.map(({ key, x, baseY, glyph }) => (
              <Pillar
                baseY={baseY}
                glyph={glyph}
                height={27 + 37 * parts[key] / demoScoring[key].weight}
                key={key}
                onPress={() => onSelect(key)}
                selected={key === selected}
                tint={tints[key]}
                x={x}
              />
            ))}
          </Svg>
        </Animated.View>
      </GestureDetector>
      <View style={[styles.readout, { backgroundColor: colors.surfaceRaised }]}>
        <Text style={[styles.readoutLabel, { color: colors.textMuted }]}>{metricDetails[selected].label.toUpperCase()}</Text>
        <Text style={[styles.readoutValue, { color: colors.text }]}>{parts[selected].toFixed(1)} <Text style={[styles.readoutMax, { color: colors.textMuted }]}>/ {demoScoring[selected].weight} demo pts</Text></Text>
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>Pillar height represents sample weighted points. The list below gives the same information without 3D interaction.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 11, marginTop: 5 },
  demo: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginTop: 4 },
  boardFrame: { height: 245, marginTop: 10, borderRadius: 16, overflow: 'hidden', backgroundColor: '#181818' },
  readout: { borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  readoutLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, flexShrink: 1 },
  readoutValue: { fontSize: 15, fontWeight: '800' },
  readoutMax: { fontSize: 10, fontWeight: '500' },
  caption: { fontSize: 10, lineHeight: 15, marginTop: 11 },
});
