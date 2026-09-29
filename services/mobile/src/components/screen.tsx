import type { ReactNode, RefObject } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type GestureResponderEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme';

export function Screen({ children, contentStyle, onScroll, onTouchStart, scroll = true, scrollEventThrottle = 16, scrollRef }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; onScroll?: ScrollViewProps['onScroll']; onTouchStart?: (event: GestureResponderEvent) => void; scroll?: boolean; scrollEventThrottle?: number; scrollRef?: RefObject<ScrollView | null> }) {
  const { colors } = useAppTheme();
  const content = <View onTouchStart={onTouchStart} style={[styles.content, contentStyle]}>{children}</View>;

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {scroll ? (
          <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={scrollEventThrottle} showsVerticalScrollIndicator={false}>
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
  content: { width: '100%', maxWidth: 760, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36 },
});
