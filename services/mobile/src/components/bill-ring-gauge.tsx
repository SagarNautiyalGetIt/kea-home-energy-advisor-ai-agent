import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

/*
 * BillRingGauge — Bill Shock ring animation for the Bill prediction modal.
 *
 * Frame-by-frame matched to the "Bill Shock Alert ring animation.mp4" reference video
 * (the single source of truth). Every number below was MEASURED from the video frames,
 * not guessed:
 *
 * - 480x480 canvas, ring center (240, 215), radius 105, stroke 18, transparent background
 * - track: full circle, #231C23, with 72 subtle tick marks (every 5deg)
 * - ring starts drawing exactly at the BOTTOM, clockwise, at a constant ~125 deg/sec
 *   (linear — no easing), then HOLDS the final state (no loop, no replay)
 * - 3 equal 120deg colour zones: green #22C55E (90->210), orange #FB923C (210->330),
 *   red #EF4444 (330->450); zone arcs are JS-computed SVG paths (no transform tricks)
 * - data mapping: overshootPct 0 -> 80deg drawn, 100 -> 312deg drawn
 *   (red stops at 60% of its zone, never completes the circle)
 * - white-hot head dot (r=5) with a soft zone-coloured glow (r=45) rides the tip
 * - inner lightning bolt (video's exact points) sits centred and takes the colour of
 *   whichever zone the head currently occupies; its halo glow is steady (no pulsing)
 * - reduced motion: final data state immediately, no animation
 */

const VB = 480;
const VCX = 240;
const VCY = 215;
const VR = 105;
const VSW = 18;

const GREEN = '#22C55E';
const ORANGE = '#FB923C';
const RED = '#EF4444';
const TRACK = '#231C23';

const START_DEG = 90; // bottom (screen coords, y down, clockwise = increasing angle)
const ZONE_DEG = 120;
const ZONE_STARTS = [START_DEG, START_DEG + ZONE_DEG, START_DEG + ZONE_DEG * 2];
const ZONE_COLORS = [GREEN, ORANGE, RED] as const;
const MAX_DRAW_DEG = ZONE_STARTS[2] + ZONE_DEG * 0.6;

// The video reveals the green zone first, then orange, then red. The comparison
// state supplies a minimum endpoint so a small dollar overshoot still reaches its
// correct colour zone even when the backend percentage is small.
const drawnDegrees = (v: number, tone: BillRingTone) => {
  const raw = 80 + (Math.min(100, Math.max(0, v)) / 100) * (MAX_DRAW_DEG - 80);
  const minimum = tone === 'red' ? 332 : tone === 'orange' ? 212 : 80;
  return Math.min(MAX_DRAW_DEG, Math.max(minimum, raw));
};

// measured: the three demo phases draw at ~120-137 deg/sec; use a constant 125
const DRAW_SPEED_DEG_PER_SEC = 125;

// lightning bolt points measured from the video frames (relative to ring centre)
const BOLT: [number, number][] = [
  [14, -58],
  [-22, 7],
  [-3, 7],
  [-16, 59],
  [20, -13],
  [2, -13],
];
const boltPoints = BOLT.map(([x, y]) => `${VCX + x},${VCY + y}`).join(' ');

const polar = (deg: number, r: number = VR) => {
  const rad = (deg * Math.PI) / 180;
  return { x: VCX + r * Math.cos(rad), y: VCY + r * Math.sin(rad) };
};

// SVG arc path for a clockwise arc — computed directly in JS so it lands at exactly
// the right angles on iOS, Android and web (no transform / dash-offset tricks).
const arcPath = (startDeg: number, endDeg: number) => {
  if (endDeg - startDeg < 0.5) return '';
  const s = polar(startDeg);
  const e = polar(endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return (
    `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} ` +
    `A ${VR} ${VR} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
  );
};

// Static tick ring (measured: 72 ticks, every 5deg, on the outer half of the track).
// Rendered once and memoized — it never changes while the ring draws.
const RING_SIZE = 360;
const WRAP_SIZE = 280;
const RING_OFFSET = (WRAP_SIZE - RING_SIZE) / 2;

export type BillRingTone = 'green' | 'orange' | 'red';

export function BillRingGauge({ value, tone = 'green', onToneChange }: { value: number; tone?: BillRingTone; onToneChange?: (tone: BillRingTone) => void }) {
  const reduceMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [headDeg, setHeadDeg] = useState(START_DEG);
  const firstMount = useRef(true);

  const target = drawnDegrees(value, tone);

  useEffect(() => {
    const toneAtDegrees = (degrees: number): BillRingTone => degrees < 210 ? 'green' : degrees < 330 ? 'orange' : 'red';
    onToneChange?.(toneAtDegrees(START_DEG));
    const id = progress.addListener(({ value: p }) => {
      setHeadDeg(START_DEG + p);
      onToneChange?.(toneAtDegrees(START_DEG + p));
    });
    progress.stopAnimation();
    if (reduceMotion) {
      // reduced motion: final customer-data state immediately, no animation
      progress.setValue(target);
      onToneChange?.(toneAtDegrees(START_DEG + target));
    } else if (firstMount.current) {
      firstMount.current = false;
      // one-shot: blank track -> customer-data endpoint, linear, then HOLD
      progress.setValue(0);
      setHeadDeg(START_DEG);
      Animated.timing(progress, {
        duration: Math.max(400, (target / DRAW_SPEED_DEG_PER_SEC) * 1000),
        easing: Easing.linear,
        toValue: target,
        useNativeDriver: false,
      }).start();
    } else {
      // value changed while open: glide to the new endpoint, never replay from blank
      Animated.timing(progress, {
        duration: 500,
        easing: Easing.linear,
        toValue: target,
        useNativeDriver: false,
      }).start();
    }
    return () => {
      progress.removeListener(id);
    };
  }, [onToneChange, progress, target, reduceMotion]);

  const endDeg = Math.min(headDeg, MAX_DRAW_DEG);
  const head = polar(endDeg);
  const zoneColor = (absDeg: number) => (absDeg < 210 ? GREEN : absDeg < 330 ? ORANGE : RED);
  const headColor = zoneColor(endDeg);
  const showHead = endDeg > START_DEG + 2;

  const pct = Math.round(Math.min(100, Math.max(0, value)));
  const state = tone === 'green' ? 'within expectation' : tone === 'orange' ? 'slightly above expected' : 'above expected';

  return (
    <View
      accessibilityLabel={`Projected bill ${state}, ${pct} percent above expected`}
      accessibilityRole="image"
      style={styles.wrap}
    >
      <Svg height={RING_SIZE} style={styles.svg} viewBox={`0 0 ${VB} ${VB}`} width={RING_SIZE}>
        <Defs>
          <RadialGradient cx="50%" cy="50%" id="billShockBoltGlow" r="50%">
            <Stop offset="0%" stopColor={headColor} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={headColor} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient cx="50%" cy="50%" id="billShockHeadGlow" r="50%">
            <Stop offset="0%" stopColor={headColor} stopOpacity={0.6} />
            <Stop offset="100%" stopColor={headColor} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* faint full track */}
        <Circle cx={VCX} cy={VCY} fill="none" r={VR} stroke={TRACK} strokeWidth={VSW} />

        {/* the three continuous colour zones, drawn as JS-computed arc paths */}
        {[0, 1, 2].map((i) => {
          const d = arcPath(ZONE_STARTS[i], Math.min(endDeg, ZONE_STARTS[i] + ZONE_DEG));
          return d ? (
            <Path d={d} fill="none" key={i} stroke={ZONE_COLORS[i]} strokeLinecap="round" strokeWidth={VSW} />
          ) : null;
        })}
        {/* inner lightning spark, colour synced with the head's zone (steady glow) */}
        <Circle cx={VCX} cy={VCY} fill="url(#billShockBoltGlow)" r={65} />
        <Polygon fill={headColor} points={boltPoints} />

        {/* glowing head riding the drawing tip */}
        {showHead ? (
          <G>
            <Circle cx={head.x} cy={head.y} fill="url(#billShockHeadGlow)" r={45} />
            <Circle cx={head.x} cy={head.y} fill="#FFFFFF" r={5} />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', height: WRAP_SIZE, justifyContent: 'center', overflow: 'visible', width: WRAP_SIZE },
  svg: { left: RING_OFFSET, position: 'absolute', top: RING_OFFSET },
});
