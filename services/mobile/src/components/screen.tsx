import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type GestureResponderEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuroraMotion } from '@/components/aurora-motion';
import { CardHue } from '@/components/card-hue';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useAppTheme } from '@/theme';

const hueColors = ['#BA8AFF', '#63F09A', '#5AB8FF'] as const;

function CyclingHue({ startIndex = 0, stretch = false }: { startIndex?: number; stretch?: boolean }) {
  const active = useActiveAnimation();
  const [reduced, setReduced] = useState(true);
  const [colorIndex, setColorIndex] = useState(startIndex);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active || reduced) return;
    const timer = setInterval(() => setColorIndex((current) => (current + 1) % hueColors.length), 15_000);
    return () => clearInterval(timer);
  }, [active, reduced]);
  return <View accessible={false} pointerEvents="none" style={StyleSheet.absoluteFill}><CardHue color={hueColors[colorIndex]} stretch={stretch} /></View>;
}

export function Screen({ children, contentStyle, hue = false, hueStart = 0, hueStretch = false, onScroll, onTouchStart, scroll = true, scrollEnabled = true, scrollEventThrottle = 16, scrollRef }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; hue?: boolean; hueStart?: number; hueStretch?: boolean; onScroll?: ScrollViewProps['onScroll']; onTouchStart?: (event: GestureResponderEvent) => void; scroll?: boolean; scrollEnabled?: boolean; scrollEventThrottle?: number; scrollRef?: RefObject<ScrollView | null> }) {
  const { colors } = useAppTheme();
  const content = <View onTouchStart={onTouchStart} style={[styles.content, contentStyle]}>{children}</View>;

  const screen = (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      {hue ? <View pointerEvents="none" style={StyleSheet.absoluteFill}><CyclingHue startIndex={hueStart} stretch={hueStretch} /></View> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {scroll ? (
          <Animated.ScrollView ref={scrollRef} scrollEnabled={scrollEnabled} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={scrollEventThrottle} showsVerticalScrollIndicator={false}>
            {content}
          </Animated.ScrollView>
        ) : content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  return hue ? <AuroraMotion>{screen}</AuroraMotion> : screen;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 760, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36 },
});
