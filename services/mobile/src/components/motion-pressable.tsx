import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** A quiet compression and release, shared by the app's main controls. */
export function MotionPressable({ children, disabled, onPressIn, onPressOut, style, ...rest }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  const animate = (toValue: number, duration: number) => {
    scale.stopAnimation();
    Animated.timing(scale, { toValue, duration, easing: Easing.out(Easing.exp), useNativeDriver: Platform.OS !== 'web' }).start();
  };
  const pressIn = (event: GestureResponderEvent) => {
    if (!reduceMotion && !disabled) animate(0.975, 115);
    onPressIn?.(event);
  };
  const pressOut = (event: GestureResponderEvent) => {
    animate(1, reduceMotion ? 0 : 230);
    onPressOut?.(event);
  };
  return <AnimatedPressable {...rest} disabled={disabled} onPressIn={pressIn} onPressOut={pressOut} style={[style, { transform: [{ scale }] }]}>{children}</AnimatedPressable>;
}
