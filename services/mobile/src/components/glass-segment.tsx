import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '@/theme';

export type GlassSegmentOption<T extends string> = {
  value: T;
  label: string;
};

type GlassSegmentedProps<T extends string> = {
  value: T;
  options: readonly GlassSegmentOption<T>[];
  onChange: (value: T) => void;
  /** Height of each option row; the glass pill matches it. Defaults to 44. */
  height?: number;
  accessibilityLabel?: string;
  appearance?: 'default' | 'usage';
};

type Frame = { x: number; width: number };

/**
 * Apple "Liquid Glass" segmented control.
 *
 * Instead of swapping a flat background on the active option, a frosted-glass
 * pill springs (morphs) to whichever option is selected — the same motion
 * language as iOS 26's glass segmented controls. One component drives every
 * segmented control in the app so the effect is consistent everywhere.
 */
export function GlassSegmented<T extends string>({
  value,
  options,
  onChange,
  height = 44,
  accessibilityLabel,
  appearance = 'default',
}: GlassSegmentedProps<T>) {
  const { colors, mode } = useAppTheme();
  const dark = mode === 'dark';
  const reduceMotion = useReducedMotion();
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const [frames, setFrames] = useState<readonly Frame[]>([]);
  const measured = useRef(false);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillOpacity = useSharedValue(0);

  // If the option list changes shape, re-measure from scratch.
  useEffect(() => {
    measured.current = false;
    setFrames([]);
  }, [options.length]);

  const handleLayout = (index: number) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setFrames((prev) => {
      if (prev.length !== options.length) {
        const next = Array.from({ length: options.length }, () => ({ x: 0, width: 0 }));
        next[index] = { x, width };
        return next;
      }
      const current = prev[index];
      if (current && Math.abs(current.x - x) < 0.5 && Math.abs(current.width - width) < 0.5) return prev;
      const next = [...prev];
      next[index] = { x, width };
      return next;
    });
  };

  useEffect(() => {
    if (frames.length !== options.length) return;
    const frame = frames[activeIndex];
    if (!frame || frame.width === 0) return;
    if (!measured.current) {
      // First layout: place the pill instantly so there is no visible pop.
      pillX.value = frame.x;
      pillWidth.value = frame.width;
      pillOpacity.value = 1;
      measured.current = true;
      return;
    }
    if (reduceMotion) {
      pillX.value = withTiming(frame.x, { duration: 140 });
      pillWidth.value = withTiming(frame.width, { duration: 140 });
    } else {
      // Liquid-glass morph: slightly under-damped spring so the pill
      // stretches and settles like Apple's glass selector.
      const spring = { stiffness: 380, damping: 31, mass: 0.9 };
      pillX.value = withSpring(frame.x, spring);
      pillWidth.value = withSpring(frame.width, spring);
    }
    pillOpacity.value = 1;
  }, [activeIndex, frames, options.length, pillOpacity, pillWidth, pillX, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
    opacity: pillOpacity.value,
  }));

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radiogroup"
      style={[styles.container, appearance === 'usage' && styles.usageContainer, { backgroundColor: appearance === 'usage' ? '#202722' : colors.input, borderColor: appearance === 'usage' ? '#29312D' : colors.border }]}
    >
      <View style={styles.row}>
        {appearance === 'usage' ? null : <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]}>
          <BlurView intensity={dark ? 45 : 70} style={styles.pillBlur} tint={dark ? 'dark' : 'light'} />
          {/* Glossy top highlight — the liquid-glass sheen. */}
          <View pointerEvents="none" style={[styles.pillGloss, { backgroundColor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.35)' }]} />
          <View
            pointerEvents="none"
            style={[styles.pillBorder, { borderColor: dark ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.85)' }]}
          />
        </Animated.View>}
        {options.map((option, index) => {
          const active = index === activeIndex;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              hitSlop={4}
              key={option.value}
              onLayout={handleLayout(index)}
              onPress={() => {
                if (option.value === value) return;
                void Haptics.selectionAsync();
                onChange(option.value);
              }}
              style={[styles.option, appearance === 'usage' && styles.usageOption, appearance === 'usage' && active && styles.usageActiveOption, { height }]}
            >
              <Text style={[styles.label, { color: active ? appearance === 'usage' ? '#000000' : colors.text : colors.textMuted }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const PILL_RADIUS = 11;

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 3,
  },
  row: {
    flexDirection: 'row',
  },
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: PILL_RADIUS,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    zIndex: 2,
  },
  usagePill: { backgroundColor: '#FFFFFF', borderRadius: 999 },
  usagePillBorder: { borderRadius: 999 },
  usageContainer: { borderRadius: 999, borderWidth: 1, borderColor: '#29312D', padding: 3, backgroundColor: '#202722' },
  usageOption: { zIndex: 3, borderWidth: 0, borderRadius: 999, backgroundColor: 'transparent' },
  usageActiveOption: { backgroundColor: '#FFFFFF' },
  pillBlur: {
    ...StyleSheet.absoluteFill,
    borderRadius: PILL_RADIUS,
  },
  pillGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    borderTopLeftRadius: PILL_RADIUS,
    borderTopRightRadius: PILL_RADIUS,
  },
  pillBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderRadius: PILL_RADIUS,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PILL_RADIUS,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
});
