import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type GestureResponderEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuroraMotion } from '@/components/aurora-motion';
import { CardHue } from '@/components/card-hue';
import { HueScreenContext } from '@/components/hue-screen-context';
import { useAppTheme } from '@/theme';

const cardHueColors = ['#BA8AFF', '#63F09A', '#5AB8FF'] as const;

function CyclingCardHue({ startIndex = 0, stretch = false }: { startIndex?: number; stretch?: boolean }) {
  const [colorIndex, setColorIndex] = useState(startIndex);
  useEffect(() => {
    const timer = setInterval(() => {
      setColorIndex((current) => (current + 1) % cardHueColors.length);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);
  return <View accessible={false} pointerEvents="none" style={StyleSheet.absoluteFill}><CardHue color={cardHueColors[colorIndex]} stretch={stretch} /></View>;
}

export function Screen({ children, contentStyle, hue = false, hueHeight, hueStart = 0, hueStretch = false, onScroll, onTouchStart, scroll = true, scrollEnabled = true, scrollEventThrottle = 16, scrollRef }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; hue?: boolean; hueHeight?: number; hueStart?: number; hueStretch?: boolean; onScroll?: ScrollViewProps['onScroll']; onTouchStart?: (event: GestureResponderEvent) => void; scroll?: boolean; scrollEnabled?: boolean; scrollEventThrottle?: number; scrollRef?: RefObject<ScrollView | null> }) {
  const { colors } = useAppTheme();
  const content = <View onTouchStart={onTouchStart} style={[styles.content, contentStyle]}>{children}</View>;
  const screen = (
    <HueScreenContext.Provider value={hue}>
      <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
        {hue ? <View pointerEvents="none" style={hueHeight ? { height: hueHeight, left: 0, position: 'absolute', right: 0, top: 0 } : StyleSheet.absoluteFill}><CyclingCardHue startIndex={hueStart} stretch={hueStretch} /></View> : null}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          {scroll ? (
            <Animated.ScrollView ref={scrollRef} scrollEnabled={scrollEnabled} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={scrollEventThrottle} showsVerticalScrollIndicator={false}>
              {content}
            </Animated.ScrollView>
          ) : content}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </HueScreenContext.Provider>
  );
  return hue ? <AuroraMotion>{screen}</AuroraMotion> : screen;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 760, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36 },
});
