import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { demoScoreParts, demoScoring, metricDetails, type DemoMetrics, type MetricKey } from '@/lib/clash-preview';
import { ARENA_PILLARS, arenaGestureMoved, arenaPillarAt, arenaTilt } from '@/lib/clash-arena';
import { ClashHue, useClashColors } from './ClashHue';

function Pillar({ x, baseY, height, glyph, selected, tint }: { x: number; baseY: number; height: number; glyph: string; selected: boolean; tint: string }) {
  const topY = baseY - height - (selected ? 5 : 0);
  const bottomY = baseY - (selected ? 5 : 0);
  return (
    <G>
      <Polygon fill={tint} fillOpacity={0.65} points={`${x - 23},${topY} ${x},${topY + 11} ${x},${bottomY + 11} ${x - 23},${bottomY}`} />
      <Polygon fill={tint} fillOpacity={0.4} points={`${x},${topY + 11} ${x + 23},${topY} ${x + 23},${bottomY} ${x},${bottomY + 11}`} />
      <Polygon fill={tint} points={`${x},${topY - 11} ${x + 23},${topY} ${x},${topY + 11} ${x - 23},${topY}`} stroke={tint} strokeWidth={selected ? 2 : 1} />
      <SvgText fill="#171717" fontSize={glyph.length > 1 ? 8 : 10} fontWeight="800" textAnchor="middle" x={x} y={topY + 3}>{glyph}</SvgText>
    </G>
  );
}

export function EnergyArena({ metrics, selected, onSelect, motion = true, onInteractionChange }: { metrics: DemoMetrics; selected: MetricKey; onSelect: (key: MetricKey) => void; motion?: boolean; onInteractionChange?: (interacting: boolean) => void }) {
  const colors = useClashColors();
  const reducedMotion = useReducedMotion();
  const tints = { ev: colors.icons.info, solar: colors.icons.money, conservation: colors.icons.success, offPeak: colors.icons.warm };
  const parts = demoScoreParts(metrics);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const selection = useSharedValue(0);
  const board = useRef<View>(null);
  const touch = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const current = useRef({ metrics, selected, onSelect });
  useEffect(() => { current.current = { metrics, selected, onSelect }; }, [metrics, selected, onSelect]);
  useEffect(() => () => { onInteractionChange?.(false); }, [onInteractionChange]);
  useEffect(() => {
    selection.value = motion && !reducedMotion ? withSequence(withTiming(1, { duration: 100 }), withTiming(0, { duration: 240 })) : 0;
    return () => cancelAnimation(selection);
  }, [motion, reducedMotion, selected, selection]);
  const pan = useMemo(() => {
    const settle = () => {
      tiltX.value = reducedMotion || !motion ? 0 : withTiming(0, { duration: 260 });
      tiltY.value = reducedMotion || !motion ? 0 : withTiming(0, { duration: 260 });
      onInteractionChange?.(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: event => {
        touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        moved.current = arenaGestureMoved(false, 0, 0, event.nativeEvent.touches.length);
        cancelAnimation(tiltX); cancelAnimation(tiltY);
        tiltX.value = 0; tiltY.value = 0;
        onInteractionChange?.(true);
      },
      onPanResponderStart: (_, gesture) => {
        moved.current = arenaGestureMoved(moved.current, gesture.dx, gesture.dy, gesture.numberActiveTouches);
      },
      onPanResponderMove: (_, gesture) => {
        moved.current = arenaGestureMoved(moved.current, gesture.dx, gesture.dy, gesture.numberActiveTouches);
        if (reducedMotion || !motion) return;
        const tilt = arenaTilt(gesture.dx, gesture.dy);
        tiltX.value = tilt.x; tiltY.value = tilt.y;
      },
      onPanResponderRelease: (_, gesture) => {
        settle();
        if (arenaGestureMoved(moved.current, gesture.dx, gesture.dy, gesture.numberActiveTouches)) return;
        const tap = { ...touch.current };
        board.current?.measureInWindow((x, y, width, height) => {
          if (!board.current) return;
          const { metrics: values, selected: chosen, onSelect: select } = current.current;
          const scores = demoScoreParts(values);
          const heights = Object.fromEntries(ARENA_PILLARS.map(p => [p.key, 27 + 37 * scores[p.key] / demoScoring[p.key].weight])) as Record<MetricKey, number>;
          const hit = arenaPillarAt(tap.x - x, tap.y - y, width, height, heights, chosen);
          if (hit) select(hit);
        });
      },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false,
    });
  }, [motion, reducedMotion, onInteractionChange, tiltX, tiltY]);
  const tiltStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 700 }, { rotateX: `${tiltX.value}deg` }, { rotateY: `${tiltY.value}deg` }, { scale: 1 + selection.value * 0.014 }] }));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <ClashHue color={tints[selected]} />
      <View style={styles.heading}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>The score arena</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{motion && !reducedMotion ? 'Tap a pillar · drag sideways to tilt' : 'Tap a pillar to explore its score'}</Text>
        </View>
        <Text style={[styles.demo, { color: colors.textMuted }]}>ISOMETRIC DEMO</Text>
      </View>
      <View ref={board} collapsable={false} {...pan.panHandlers} style={styles.gestureFrame}>
        <Animated.View accessibilityLabel="Interactive isometric energy score board. Use the score categories below for accessible details." accessibilityRole="image" style={[styles.boardFrame, { backgroundColor: colors.surfaceRaised }, tiltStyle]}>
          <ClashHue color={tints[selected]} />
          <Svg height="100%" viewBox="0 0 300 245" width="100%">
            <Polygon fill={colors.border} points="15,105 150,211 150,230 15,124" />
            <Polygon fill={colors.border} points="150,211 285,105 285,124 150,230" />
            <Polygon fill={colors.surface} points="150,29 285,105 150,211 15,105" stroke={colors.border} strokeWidth="1.5" />
            <Polygon fill="none" points="150,47 265,108 150,194 35,108" stroke={colors.border} strokeWidth="1" />
            {ARENA_PILLARS.map(({ key, x, baseY, glyph }) => (
              <Pillar
                baseY={baseY}
                glyph={glyph}
                height={27 + 37 * parts[key] / demoScoring[key].weight}
                key={key}
                selected={key === selected}
                tint={tints[key]}
                x={x}
              />
            ))}
          </Svg>
        </Animated.View>
      </View>
      <View style={[styles.readout, { backgroundColor: colors.surfaceRaised }]}>
        <Text style={[styles.readoutLabel, { color: colors.textMuted }]}>{metricDetails[selected].label.toUpperCase()}</Text>
        <Text style={[styles.readoutValue, { color: colors.text }]}>{parts[selected].toFixed(1)} <Text style={[styles.readoutMax, { color: colors.textMuted }]}>/ {demoScoring[selected].weight} demo pts</Text></Text>
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>Sample weighted points, separate from your quest XP. The controls below provide the same information without tilting.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden', padding: 18 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  demo: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 4, maxWidth: 78 },
  gestureFrame: { height: 245, marginTop: 10 },
  boardFrame: { height: 245, borderRadius: 16, overflow: 'hidden', backgroundColor: '#181818' },
  readout: { borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  readoutLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, flexShrink: 1 },
  readoutValue: { fontSize: 15, fontWeight: '800' },
  readoutMax: { fontSize: 10, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 18, marginTop: 11 },
});
