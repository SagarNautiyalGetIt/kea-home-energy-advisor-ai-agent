import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

const CENTER = 50;

function pointOnCircle(radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  };
}

function arcPath(radius: number, startAngle: number, endAngle: number) {
  const start = pointOnCircle(radius, endAngle);
  const end = pointOnCircle(radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function Orbit({ radius, angles, inner = false }: { radius: number; angles: readonly number[]; inner?: boolean }) {
  return (
    <Svg height="100%" viewBox="0 0 100 100" width="100%">
      <Circle cx={CENTER} cy={CENTER} fill="none" opacity={inner ? 0.08 : 0.1} r={radius} stroke="#6F57FF" strokeWidth={1.25} />
      {angles.map((angle, index) => (
        <G key={angle}>
          <Path d={arcPath(radius, angle - 28, angle)} fill="none" opacity={inner ? 0.55 : 0.72} stroke="#A89BFF" strokeLinecap="round" strokeWidth={1.8} />
          <Path d={arcPath(radius, angle - 5, angle + 2)} fill="none" opacity={inner ? 0.82 : 1} stroke={index === 0 ? '#8C78FF' : '#4318FF'} strokeLinecap="round" strokeWidth={3.6} />
        </G>
      ))}
    </Svg>
  );
}

export function SparkyOrbit({ size = 168 }: { size?: number }) {
  const outerSpin = useSharedValue(0);
  const innerSpin = useSharedValue(0);
  const breath = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      outerSpin.value = 0.08;
      innerSpin.value = 0.12;
      breath.value = 0.5;
      return;
    }

    outerSpin.value = withRepeat(withTiming(1, { duration: 20900, easing: Easing.linear }), -1, false);
    innerSpin.value = withRepeat(withTiming(1, { duration: 28600, easing: Easing.linear }), -1, false);
    breath.value = withRepeat(withSequence(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);

    return () => {
      cancelAnimation(outerSpin);
      cancelAnimation(innerSpin);
      cancelAnimation(breath);
    };
  }, [breath, innerSpin, outerSpin, reduceMotion]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(outerSpin.value, [0, 1], [0, 360])}deg` },
      { scale: interpolate(breath.value, [0, 1], [0.97, 1.03]) },
    ],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(innerSpin.value, [0, 1], [0, -360])}deg` },
      { scale: interpolate(breath.value, [0, 1], [1.018, 0.982]) },
    ],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.58, 0.88]),
    transform: [{ scale: interpolate(breath.value, [0, 1], [0.9, 1.14]) }],
  }));

  return (
    <View accessibilityLabel="Sparky is ready" accessibilityRole="image" style={{ height: size, width: size }}>
      <Animated.View style={[styles.layer, outerStyle]}>
        <Orbit angles={[12, 132, 252]} radius={41} />
      </Animated.View>
      <Animated.View style={[styles.layer, innerStyle]}>
        <Orbit angles={[78, 258]} inner radius={27.5} />
      </Animated.View>
      <Animated.View style={[styles.layer, coreStyle]}>
        <Svg height="100%" viewBox="0 0 100 100" width="100%">
          <Defs>
            <RadialGradient cx="50%" cy="50%" id="sparky-core" r="50%">
              <Stop offset="0" stopColor="#4A25FF" stopOpacity={0.64} />
              <Stop offset="0.46" stopColor="#5F45FF" stopOpacity={0.28} />
              <Stop offset="1" stopColor="#A89BFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={CENTER} cy={CENTER} fill="url(#sparky-core)" r={10} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
