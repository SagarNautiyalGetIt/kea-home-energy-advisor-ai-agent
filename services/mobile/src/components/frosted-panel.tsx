import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/theme';

export const glassDetailColor = { dark: '#B8C2CC', light: '#414A56' } as const;

/** A single blur surface keeps every Home shortcut in the foreground. */
export function FrostedPanel({ children, blurTarget }: { children: ReactNode; blurTarget: RefObject<View | null> }) {
  const { colors, mode } = useAppTheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (mounted) setReduceTransparency(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  return <View style={styles.shadow}>
    <View testID="explore-kea-glass" style={[styles.panel, { borderColor: mode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.9)' }]}>
      {!reduceTransparency ? <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={55} tint={mode} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: reduceTransparency ? colors.surface : mode === 'dark' ? 'rgba(20,26,33,0.82)' : 'rgba(248,251,255,0.86)' }]} />
      <LinearGradient pointerEvents="none" colors={mode === 'dark' ? ['rgba(188,213,235,0.06)', 'rgba(188,213,235,0)'] : ['rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
      <View accessible={false} pointerEvents="none" style={[styles.handle, { backgroundColor: mode === 'dark' ? '#65717E' : '#AAB4BF' }]} />
      {children}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shadow: { marginHorizontal: 12, marginTop: 8, zIndex: 40, elevation: 32, shadowColor: '#000000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 18 },
  panel: { borderWidth: 1, borderRadius: 30, overflow: 'hidden', paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
});
