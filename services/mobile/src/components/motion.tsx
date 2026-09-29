import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

export function ScreenEnter({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion ? 1 : withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export function EnterItem({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion ? 1 : withDelay(index * 45, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [index, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

export function ChartReveal({ children, style }: { children: React.ReactNode; crossfadeKey?: string; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}
