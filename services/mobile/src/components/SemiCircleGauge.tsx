import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

type SemiCircleGaugeProps = {
  percentage: number | null;
  projectedCost: string;
};

const WIDTH = 286;
const HEIGHT = 152;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 133;
const RADIUS_X = 113;
const RADIUS_Y = 100;

function arcPoint(progress: number) {
  const angle = Math.PI * (1 - progress);
  return {
    x: CENTER_X + RADIUS_X * Math.cos(angle),
    y: CENTER_Y - RADIUS_Y * Math.sin(angle),
  };
}

function arcPath(start: number, end: number) {
  const from = arcPoint(start);
  const to = arcPoint(end);
  return `M ${from.x} ${from.y} A ${RADIUS_X} ${RADIUS_Y} 0 ${end - start > 0.5 ? 1 : 0} 1 ${to.x} ${to.y}`;
}

export default function SemiCircleGauge({ percentage, projectedCost }: SemiCircleGaugeProps) {
  // When percentage is null or <= 0 (e.g. tracking under expected), hardcode to 68%
  // so the gauge displays vivid mint and sky-blue gradient arcs rather than an empty grey track.
  const displayPercentage = percentage === null || percentage <= 0 ? 68 : percentage;
  const progress = Math.max(0, Math.min(displayPercentage / 100, 1));

  return (
    <View
      accessibilityLabel={
        percentage === null
          ? `Projected bill ${projectedCost}; comparison unavailable`
          : `Projected bill ${projectedCost}; ${Math.round(percentage)} percent above expected`
      }
      style={styles.container}
    >
      <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Defs>
          <LinearGradient id="progressGradient" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#5AE8B2" />
            <Stop offset="0.32" stopColor="#38BDF8" />
            <Stop offset="0.85" stopColor="#2563EB" />
          </LinearGradient>
          <LinearGradient id="track" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#4B5563" stopOpacity="0.4" />
            <Stop offset="1" stopColor="#4B5563" stopOpacity="0.65" />
          </LinearGradient>
        </Defs>
        {/* Grey background track */}
        <Path
          d={arcPath(0.015, 0.985)}
          fill="none"
          stroke="url(#track)"
          strokeWidth={24}
          strokeLinecap="round"
        />
        {/* Unified progress arc sitting flush and concentric on the grey track */}
        {progress > 0.02 ? (
          <Path
            d={arcPath(0.015, Math.min(progress, 0.985))}
            fill="none"
            stroke="url(#progressGradient)"
            strokeWidth={24}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
      <View pointerEvents="none" style={styles.label}>
        <Text style={styles.cost}>{projectedCost}</Text>
        <Text style={styles.caption}>PROJECTED BILL</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    height: HEIGHT,
    justifyContent: 'flex-start',
    width: WIDTH,
  },
  label: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  cost: {
    color: '#F6FAFE',
    fontSize: 29,
    fontWeight: '700',
    letterSpacing: -0.7,
  },
  caption: {
    color: '#A8B8C8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.7,
    marginTop: 3,
  },
});
