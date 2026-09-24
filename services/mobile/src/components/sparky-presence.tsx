import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

type Mode = 'idle' | 'thinking' | 'replying' | 'happy' | 'static';

/** Kea's own companion: a soft energy core, attentive eyes and a measured motion cadence. */
export function SparkyPresence({ size = 168, mode = 'idle' }: { size?: number; mode?: Mode }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const breath = useSharedValue(0);
  const gaze = useSharedValue(0);
  const blink = useSharedValue(1);
  const halo = useSharedValue(0);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    cancelAnimation(breath);
    cancelAnimation(gaze);
    cancelAnimation(blink);
    cancelAnimation(halo);
    if (reduceMotion || mode === 'happy' || mode === 'static') {
      breath.value = 0;
      gaze.value = 0;
      blink.value = 1;
      halo.value = 0;
      return;
    }
    const moving = mode === 'thinking';
    breath.value = withRepeat(withSequence(
      withTiming(1, { duration: moving ? 820 : 3100, easing: Easing.out(Easing.exp) }),
      withTiming(0, { duration: moving ? 930 : 3500, easing: Easing.out(Easing.exp) }),
    ), -1);
    gaze.value = withRepeat(withSequence(
      withTiming(1, { duration: 1900, easing: Easing.out(Easing.exp) }),
      withDelay(700, withTiming(-1, { duration: 2200, easing: Easing.out(Easing.exp) })),
      withDelay(700, withTiming(0, { duration: 1600, easing: Easing.out(Easing.exp) })),
    ), -1);
    blink.value = withRepeat(withSequence(
      withDelay(moving ? 2300 : 4200, withTiming(0.08, { duration: 75 })),
      withTiming(1, { duration: 135, easing: Easing.out(Easing.exp) }),
      withDelay(950, withTiming(1, { duration: 1 })),
    ), -1);
    halo.value = withRepeat(withSequence(
      withTiming(1, { duration: moving ? 1400 : 4700, easing: Easing.out(Easing.exp) }),
      withTiming(0, { duration: moving ? 1400 : 4700, easing: Easing.out(Easing.exp) }),
    ), -1);
    return () => { cancelAnimation(breath); cancelAnimation(gaze); cancelAnimation(blink); cancelAnimation(halo); };
  }, [blink, breath, gaze, halo, mode, reduceMotion]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(breath.value, [0, 1], [0.98, mode === 'thinking' ? 1.055 : 1.022]) },
      { scaleY: interpolate(breath.value, [0, 1], [1.02, mode === 'thinking' ? 0.952 : 0.985]) },
      { rotate: `${interpolate(breath.value, [0, 1], [-2.2, 2.2])}deg` },
    ],
  }));
  const gazeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(gaze.value, [-1, 1], [-3.6, 3.6]) },
      { translateY: interpolate(gaze.value, [-1, 1], [1.2, -1.2]) },
      { scaleY: blink.value },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(halo.value, [0, 1], [0.38, mode === 'thinking' ? 0.86 : 0.58]),
    transform: [{ scale: interpolate(halo.value, [0, 1], [0.96, 1.07]) }],
  }));

  return <View accessibilityLabel={mode === 'thinking' ? 'Sparky is thinking' : mode === 'happy' ? 'Sparky answered' : 'Sparky is here'} accessibilityRole="image" style={{ height: size, width: size }}>
    <Animated.View style={[styles.layer, haloStyle]}>
      <Svg height="100%" viewBox="0 0 120 120" width="100%">
        <Defs>
          <RadialGradient cx="50%" cy="50%" id="halo" r="50%"><Stop offset="0" stopColor="#38BDF8" stopOpacity="0.42" /><Stop offset="0.65" stopColor="#63F09A" stopOpacity="0.13" /><Stop offset="1" stopColor="#38BDF8" stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx="60" cy="60" fill="url(#halo)" r="58" />
        <Path d="M 17 59 A 43 43 0 0 1 51 18" fill="none" stroke="#63F09A" strokeLinecap="round" strokeOpacity="0.7" strokeWidth="2" />
        <Path d="M 70 102 A 43 43 0 0 0 104 63" fill="none" stroke="#38BDF8" strokeLinecap="round" strokeOpacity="0.72" strokeWidth="2" />
      </Svg>
    </Animated.View>
    <Animated.View style={[styles.layer, bodyStyle]}>
      <Svg height="100%" viewBox="0 0 120 120" width="100%">
        <Defs>
          <LinearGradient id="body" x1="0" x2="1" y1="0" y2="1"><Stop offset="0" stopColor="#2B8C9F" /><Stop offset="0.55" stopColor="#14536C" /><Stop offset="1" stopColor="#102B43" /></LinearGradient>
          <RadialGradient cx="36%" cy="22%" id="glow" r="70%"><Stop offset="0" stopColor="#ACF7D6" stopOpacity="0.35" /><Stop offset="1" stopColor="#ACF7D6" stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx="60" cy="60" fill="url(#body)" r="39" stroke="#63F09A" strokeOpacity="0.46" strokeWidth="1.4" />
        <Circle cx="60" cy="60" fill="url(#glow)" r="38" />
        <Path d="M 30 47 C 36 34 47 26 62 24" fill="none" stroke="#D5FFF0" strokeLinecap="round" strokeOpacity="0.24" strokeWidth="2" />
      </Svg>
    </Animated.View>
    <Animated.View style={[styles.layer, gazeStyle]}>
      {mode === 'happy' ? (
        <Svg height="100%" viewBox="0 0 120 120" width="100%">
          {/* Happy smiling eyes ^ ^ */}
          <Path d="M 42 61 C 44 51 52 51 54 61" fill="none" stroke="#123B50" strokeLinecap="round" strokeWidth="3" />
          <Path d="M 66 61 C 68 51 76 51 78 61" fill="none" stroke="#123B50" strokeLinecap="round" strokeWidth="3" />
          {/* Subtle blush */}
          <Circle cx="37" cy="65" fill="#FF8A80" opacity={0.4} r="4.5" />
          <Circle cx="83" cy="65" fill="#FF8A80" opacity={0.4} r="4.5" />
          {/* Gentle happy smile */}
          <Path d="M 56 69 Q 60 74 64 69" fill="none" stroke="#123B50" strokeLinecap="round" strokeWidth="2.2" />
        </Svg>
      ) : (
        <Svg height="100%" viewBox="0 0 120 120" width="100%">
          <Ellipse cx="48" cy="58" fill="#F4FFFC" rx="6.5" ry="9" />
          <Ellipse cx="72" cy="58" fill="#F4FFFC" rx="6.5" ry="9" />
          <Circle cx="50" cy="59" fill="#123B50" r="2.2" />
          <Circle cx="74" cy="59" fill="#123B50" r="2.2" />
        </Svg>
      )}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({ layer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } });
