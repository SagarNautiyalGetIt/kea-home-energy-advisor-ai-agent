import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const HEIGHT = 210;
const WIDTH = 360;
const BASELINE = 174;
const PATH = 'M12 149 C45 138 58 157 89 128 C120 100 149 117 181 91 C214 66 243 107 273 72 C301 40 326 55 348 28';
const AREA = `${PATH} L348 ${BASELINE} L12 ${BASELINE} Z`;
const LENGTH = 520;
const LOADER_POINTS = [
  { x: 12, y: 149 }, { x: 61, y: 150 }, { x: 109, y: 120 },
  { x: 157, y: 109 }, { x: 205, y: 75 }, { x: 253, y: 89 }, { x: 303, y: 47 },
];

function LoaderPoint({ delay, x, y, color }: { delay: number; x: number; y: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withSequence(
        withDelay(delay, withTiming(1, { duration: 210, easing: Easing.out(Easing.quad) })),
        withDelay(640, withTiming(0, { duration: 0 })),
      ),
      1,
      false,
    );
  }, [delay, progress]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: progress.value,
    r: 2 + progress.value * 1.5,
  }));

  return <AnimatedCircle animatedProps={animatedProps} cx={x} cy={y} fill={color} stroke={color} strokeOpacity={0.65} strokeWidth="1.5" />;
}

function LoaderBar({ delay, height, x, color }: { delay: number; height: number; x: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withSequence(
        withDelay(delay, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) })),
        withDelay(560, withTiming(0, { duration: 0 })),
      ),
      1,
      false,
    );
  }, [delay, progress]);

  const animatedProps = useAnimatedProps(() => ({
    height: height * progress.value,
    opacity: progress.value * 0.24,
    y: BASELINE - height * progress.value,
  }));

  return <AnimatedRect animatedProps={animatedProps} fill={color} rx="2" width="19" x={x} />;
}

/** Visual-only loading state; it never supplies or changes Usage data. */
export function UsageChartLoader({ color = '#C7F071' }: { color?: string }) {
  const draw = useSharedValue(0);
  const entrance = useSharedValue(0);
  const grid = useSharedValue(0);
  const glow = useSharedValue(0);
  const cursor = useSharedValue(0);

  useEffect(() => {
    draw.value = 0; entrance.value = 0; grid.value = 0; glow.value = 0; cursor.value = 0;
    entrance.value = withTiming(1, { duration: 850, easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
    grid.value = withRepeat(withSequence(withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }), withDelay(1100, withTiming(0, { duration: 0 }))), 1, false);
    draw.value = withRepeat(withSequence(withDelay(170, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) })), withDelay(390, withTiming(0, { duration: 0 }))), 1, false);
    glow.value = withRepeat(withSequence(withDelay(810, withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) })), withDelay(340, withTiming(0, { duration: 0 }))), 1, false);
    cursor.value = withRepeat(withSequence(withDelay(570, withTiming(1, { duration: 390, easing: Easing.inOut(Easing.cubic) })), withDelay(370, withTiming(0, { duration: 0 }))), 1, false);
  }, [cursor, draw, entrance, glow, grid]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: LENGTH * (1 - draw.value) }));
  const areaProps = useAnimatedProps(() => ({ opacity: draw.value * 0.42 }));
  const gridProps = useAnimatedProps(() => ({ opacity: grid.value }));
  const cursorProps = useAnimatedProps(() => ({ cx: 22 + cursor.value * 315, cy: 148 - cursor.value * 95, opacity: glow.value }));
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + entrance.value * 0.8,
    transform: [
      { perspective: 850 },
      { translateY: (1 - entrance.value) * 28 },
      { scale: 0.9 + entrance.value * 0.1 },
      { rotateX: `${(1 - entrance.value) * 13}deg` },
      { rotateZ: `${(1 - entrance.value) * -2}deg` },
    ],
  }));

  return <Animated.View accessible accessibilityLabel="Loading usage chart" style={[styles.wrap, entranceStyle]}>
    <Svg height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <Defs><LinearGradient id="usage-loader-fill" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity={0.42} /><Stop offset="1" stopColor={color} stopOpacity={0} /></LinearGradient></Defs>
      <AnimatedPath animatedProps={gridProps} d="M10 42H350 M10 86H350 M10 130H350 M10 174H350 M18 18V174 M70 18V174 M122 18V174 M174 18V174 M226 18V174 M278 18V174 M330 18V174" fill="none" stroke="#3A3A3C" strokeDasharray="5 7" strokeOpacity={0.42} />
      {[44, 93, 142, 191, 240, 289].map((x, index) => <LoaderBar color={color} delay={120 + index * 72} height={[34, 51, 40, 64, 46, 73][index]!} key={x} x={x} />)}
      <AnimatedPath animatedProps={areaProps} d={AREA} fill="url(#usage-loader-fill)" />
      <AnimatedPath animatedProps={lineProps} d={PATH} fill="none" stroke={color} strokeDasharray={LENGTH} strokeLinecap="round" strokeWidth="3.5" />
      {LOADER_POINTS.map((point, index) => <LoaderPoint color={color} delay={470 + index * 70} key={point.x} x={point.x} y={point.y} />)}
      <AnimatedCircle animatedProps={cursorProps} fill="#FFFFFF" r="5" stroke={color} strokeWidth="3" />
    </Svg>
    <View style={styles.sheen} />
  </Animated.View>;
}

const styles = StyleSheet.create({ wrap: { height: HEIGHT, marginTop: 102, paddingHorizontal: 4, overflow: 'hidden' }, sheen: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' } });
