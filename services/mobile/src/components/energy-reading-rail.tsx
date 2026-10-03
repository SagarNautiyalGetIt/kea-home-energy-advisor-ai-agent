import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { tactile } from '@/lib/haptics';
import { useAppTheme } from '@/theme';
import { CardHue } from './card-hue';
import { AuroraMotion } from './aurora-motion';

type Reading = { id: string; label: string; value: string; detail: string; color: string };

export function EnergyReadingRail({ readings, selected, onSelect, cardWidth }: {
  readings: Reading[]; selected: string; onSelect: (id: string) => void; cardWidth: number;
}) {
  const { colors } = useAppTheme();
  const scroll = useRef<ScrollView>(null);
  const height = useRef(new Animated.Value(1)).current;
  const touched = useRef(false);
  const [expanded, setExpanded] = useState(true);
  const [accessibleMotion, setAccessibleMotion] = useState(true);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const maximum = Math.max(0, content - viewport);
  const position = maximum > 0 ? Math.round(offset / maximum * 4) : 0;

  useEffect(() => {
    let active = true;
    const refresh = () => { void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()]).then(([motion, reader]) => { if (active) setAccessibleMotion(motion || reader); }); };
    refresh();
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', refresh);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', refresh);
    return () => { active = false; motion.remove(); reader.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    touched.current = false;
    setExpanded(true);
    const timer = setTimeout(() => { if (!accessibleMotion && !touched.current) setExpanded(false); }, 2800);
    return () => clearTimeout(timer);
  }, [accessibleMotion]));

  useEffect(() => {
    const animation = Animated.timing(height, { toValue: expanded ? 1 : 0, duration: accessibleMotion ? 0 : 420, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [expanded, accessibleMotion, height]);

  const move = (next: number) => {
    touched.current = true;
    tactile();
    scroll.current?.scrollTo({ x: Math.max(0, Math.min(maximum, next)), animated: !accessibleMotion });
  };
  return <AuroraMotion><View>
    <View style={styles.header}>
      <Text style={[styles.hint, { color: colors.textMuted }]}>YOUR ENERGY · SWIPE TO EXPLORE</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Compact energy readings' : 'Expand energy readings'} accessibilityState={{ expanded }} onPress={() => { touched.current = true; tactile(); setExpanded(!expanded); }} style={styles.control}>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.text} size={18} />
        <Text style={{ color: colors.text, fontSize: 11 }}>{expanded ? 'Compact' : 'Details'}</Text>
      </Pressable>
    </View>
    <View onLayout={(event) => setViewport(event.nativeEvent.layout.width)}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScrollBeginDrag={() => { touched.current = true; }} onScroll={(event) => setOffset(Math.max(0, event.nativeEvent.contentOffset.x))} onContentSizeChange={(width) => setContent(width)} contentContainerStyle={styles.rail}>
        {readings.map((reading) => <Pressable key={reading.id} accessibilityRole="button" accessibilityState={{ selected: reading.id === selected }} accessibilityLabel={`${reading.label}: ${reading.value}, ${reading.detail}`} onPress={() => { touched.current = true; tactile(); onSelect(reading.id); }}>
          <Animated.View style={[styles.card, { width: cardWidth, backgroundColor: colors.surface, borderColor: reading.id === selected ? reading.color : colors.border, minHeight: height.interpolate({ inputRange: [0, 1], outputRange: [76, 128] }) }]}>
            <CardHue color={reading.color} />
            <View style={styles.label}><View style={[styles.dot, { backgroundColor: reading.color }]} /><Text style={[styles.name, { color: colors.textMuted }]}>{reading.label}</Text></View>
            <Text style={[styles.value, { color: colors.text }]}>{reading.value}</Text>
            <Animated.View style={{ opacity: height, maxHeight: height.interpolate({ inputRange: [0, 1], outputRange: [0, 70] }), overflow: 'hidden' }}><Text numberOfLines={3} style={[styles.detail, { color: colors.textMuted }]}>{reading.detail}</Text></Animated.View>
          </Animated.View>
        </Pressable>)}
      </ScrollView>
      {offset > 2 ? <LinearGradient pointerEvents="none" colors={[colors.background, `${colors.background}00`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, { left: 0 }]} /> : null}
      {offset < maximum - 2 ? <LinearGradient pointerEvents="none" colors={[`${colors.background}00`, colors.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, { right: 0 }]} /> : null}
    </View>
    {maximum > 2 ? <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous energy readings" disabled={offset <= 2} onPress={() => move(offset - cardWidth - 9)} style={styles.arrow}><Ionicons name="chevron-back" color={offset <= 2 ? colors.border : colors.text} size={20} /></Pressable>
      <View style={styles.positions}>{[0, 1, 2, 3, 4].map((index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Energy rail position ${index + 1} of 5`} accessibilityState={{ selected: position === index }} onPress={() => move(maximum * index / 4)} style={styles.positionTarget}><View style={[styles.position, { backgroundColor: position === index ? colors.icons.energy : colors.border, width: position === index ? 18 : 6 }]} /></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Next energy readings" disabled={offset >= maximum - 2} onPress={() => move(offset + cardWidth + 9)} style={styles.arrow}><Ionicons name="chevron-forward" color={offset >= maximum - 2 ? colors.border : colors.text} size={20} /></Pressable>
    </View> : null}
  </View></AuroraMotion>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 6 },
  hint: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 }, control: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  rail: { gap: 9, paddingHorizontal: 18, paddingBottom: 4 }, card: { borderWidth: 1, borderRadius: 14, padding: 11, overflow: 'hidden' },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { width: 7, height: 7, borderRadius: 4 },
  name: { fontSize: 10, fontWeight: '800' }, value: { fontSize: 17, fontWeight: '800', marginTop: 6 }, detail: { fontSize: 10, marginTop: 3 },
  fade: { position: 'absolute', top: 0, bottom: 0, width: 22 }, navigation: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, positions: { flexDirection: 'row' }, positionTarget: { minWidth: 30, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, position: { height: 6, borderRadius: 4 },
});
