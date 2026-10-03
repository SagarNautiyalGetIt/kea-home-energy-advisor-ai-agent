import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useActiveAnimation } from '@/lib/use-active-animation';

/** Short entrances only; focus/background cleanup leaves no decorative loop. */
export function GameTransition({ children, motion }: { children: ReactNode; motion: boolean }) {
  const active = useActiveAnimation();
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    progress.stopAnimation();
    if (!motion || !active) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 260, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => { animation.stop(); progress.setValue(1); };
  }, [active, motion, progress]);
  return <Animated.View style={[styles.content, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ content: { gap: 15 } });
