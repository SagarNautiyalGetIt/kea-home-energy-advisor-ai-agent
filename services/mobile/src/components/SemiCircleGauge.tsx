import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type SemiCircleGaugeProps = { percentage: number; projectedCost: string };

const width = 280;
const height = 168;
const centerX = width / 2;
const centerY = 142;
const rMid = 100;
const band = 24;
const SEGMENTS = 24;
const STEP = 180 / SEGMENTS;
const SEGW = 6.0;

const GREEN = '#22C55E';
const ORANGE = '#F97316';
const RED = '#EF4444';
const DIM = '#D1D5DB';

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: centerX + r * Math.cos(rad), y: centerY - r * Math.sin(rad) };
}

function barPath(i: number) {
  const a0 = 180 - i * STEP;
  const a1 = a0 - SEGW;
  const p0 = polar(rMid, a0);
  const p1 = polar(rMid, a1);
  return (
    `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ` +
    `A ${rMid} ${rMid} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  );
}

function zoneColor(i: number) {
  if (i < SEGMENTS / 3) return GREEN;
  if (i < (SEGMENTS / 3) * 2) return ORANGE;
  return RED;
}

/** Semicircular risk gauge: three zone colours as broken bars. */
export default function SemiCircleGauge({ percentage, projectedCost }: SemiCircleGaugeProps) {
  const [buildAnim] = useState(() => new Animated.Value(0));
  const [build, setBuild] = useState(0);
  const target = Math.min(Math.max(percentage, 0), 50) / 50;

  useEffect(() => {
    buildAnim.stopAnimation();
    buildAnim.setValue(0);
    const listener = buildAnim.addListener(({ value }) => setBuild(value));
    Animated.timing(buildAnim, { toValue: 1, duration: 900, useNativeDriver: false }).start();
    return () => buildAnim.removeListener(listener);
  }, [buildAnim, target]);

  const built = build * SEGMENTS;
  const litCount = target * SEGMENTS;

  return (
    <View
      accessibilityLabel={`Projected bill risk: ${projectedCost}, ${Math.round(Math.min(Math.max(percentage, 0), 100))} percent above expected`}
      style={styles.wrap}
    >
      <Svg height={144} viewBox={`0 0 ${width} ${height}`} width={240}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          i < built ? (
            <Path
              d={barPath(i)}
              fill="none"
              key={i}
              stroke={i < litCount ? zoneColor(i) : DIM}
              strokeLinecap="butt"
              strokeWidth={band}
            />
          ) : null
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { alignItems: 'center', alignSelf: 'stretch', height: 144, justifyContent: 'flex-end' } });
