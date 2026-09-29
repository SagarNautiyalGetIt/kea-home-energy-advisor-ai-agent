import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Platform, StyleSheet, type GestureResponderEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme';

export function Screen({ children, contentStyle, onScroll, onTouchStart, scroll = true, scrollEventThrottle = 16 }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; onScroll?: ScrollViewProps['onScroll']; onTouchStart?: (event: GestureResponderEvent) => void; scroll?: boolean; scrollEventThrottle?: number }) {
  const { colors } = useAppTheme();
  const entrance = useSharedValue(0);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (active) entrance.value = reduced ? 1 : withTiming(1, { duration: 340, easing: Easing.out(Easing.exp) });
    });
    return () => { active = false; };
  }, [entrance]);
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: interpolate(entrance.value, [0, 1], [7, 0]) }],
  }));
  const content = <Reanimated.View onTouchStart={onTouchStart} style={[styles.content, contentStyle, entranceStyle]}>{children}</Reanimated.View>;

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {scroll ? (
          <Animated.ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={scrollEventThrottle} showsVerticalScrollIndicator={false}>
            {content}
          </Animated.ScrollView>
        ) : content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36 },
});
