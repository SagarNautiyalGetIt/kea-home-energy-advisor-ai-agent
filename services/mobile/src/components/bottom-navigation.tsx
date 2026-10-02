import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { palette, useAppTheme } from '@/theme';
import { SparkyPresence } from './sparky-presence';

type Props = {
  includeHome?: boolean;
  listMode?: boolean;
  onNavigate?: () => void;
  billPrediction?: { detail: string; onPress: () => void; status?: 'warning' | 'normal' };
};

function BillingNavIcon({ color, detailColor, size }: { color: string; detailColor: string; size: number }) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path d="M4.5 2.8h9.8l5.2 5v9.8c0 2.5-1.7 3.8-3.4 3.8H6.2c-2 0-3.4-1.4-3.4-3.4V4.8c0-1.1.6-2 1.7-2Z" fill={color} />
      <Path d="M14.3 2.8v4.1c0 .7.5 1.2 1.2 1.2h4" fill="none" stroke={color} strokeWidth="1.2" />
      <Path d="M6 12h6M6 15h5.2M6 18h4" fill="none" stroke={detailColor} strokeLinecap="round" strokeWidth="1.3" />
      <Circle cx="16.6" cy="16.4" fill={color} r="4.8" stroke={color} strokeWidth="1.5" />
      <Path d="M17.8 13.9c-.4-.4-.9-.6-1.5-.6-1 0-1.7.5-1.7 1.2 0 1.8 3.3.8 3.3 2.5 0 .7-.7 1.2-1.7 1.2-.7 0-1.3-.2-1.7-.7M16.3 12.6v6.9" fill="none" stroke={detailColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
    </Svg>
  );
}

export function BottomNavigation({ includeHome = true, listMode = false, billPrediction, onNavigate }: Props) {
  const { colors, mode } = useAppTheme();
  const selectedColor = mode === 'dark' ? '#FFFFFF' : colors.text;
  const idleColor = mode === 'dark' ? 'rgba(255,255,255,0.52)' : colors.textMuted;
  const pathname = usePathname();
  const allItems: readonly { label: string; detail: string; path: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; tint: string }[] = [
    { label: 'Home', detail: 'Return to your energy overview', path: '/dashboard', icon: 'home', onPress: () => router.push('/dashboard'), tint: colors.text },
    { label: 'Usage', detail: 'Track your energy usage', path: '/usage', icon: 'bar-chart-outline', onPress: () => router.push('/usage'), tint: colors.icons.energy },
    { label: 'Sparky AI', detail: 'Ask about your energy', path: '/assistant', icon: 'sparkles', onPress: () => router.push('/assistant'), tint: colors.text },
    { label: 'Billing', detail: 'View your billing information', path: '/billing', icon: 'receipt', onPress: () => router.push('/billing'), tint: colors.icons.money },
    { label: 'More', detail: 'More options', path: '/more', icon: 'grid', onPress: () => router.push('/more'), tint: colors.icons.utility },
  ];
  const navigationItems = includeHome ? allItems : allItems.filter((item) => item.label !== 'Home');
  const items = listMode && billPrediction
    ? [{ label: 'Bill prediction', detail: billPrediction.detail, path: '', icon: 'alert-circle-outline' as const, onPress: billPrediction.onPress, tint: colors.text }, ...navigationItems.filter(item => item.label !== 'More'), { label: 'Power Clash', detail: 'Explore the suburb league · demo', path: '/clash', icon: 'trophy-outline' as const, onPress: () => router.push('/clash'), tint: colors.icons.warm }, ...navigationItems.filter(item => item.label === 'More')]
    : navigationItems;

  return <View style={[styles.container, listMode && styles.listContainer, { borderColor: colors.border, backgroundColor: listMode ? 'transparent' : colors.surface, paddingBottom: 0 }]}>
    {!listMode ? <BlurView intensity={72} tint={mode} pointerEvents="none" style={styles.glassBackground} /> : null}
    {!listMode ? <View pointerEvents="none" style={styles.glassTint} /> : null}
    {items.map((item) => {
      const warning = listMode && item.label === 'Bill prediction' && billPrediction?.status === 'warning';
      const normal = listMode && item.label === 'Bill prediction' && billPrediction?.status === 'normal';
      return <Pressable accessibilityLabel={`Open ${item.label}`} accessibilityRole={listMode ? 'button' : 'tab'} accessibilityState={{ selected: pathname === item.path }} key={item.label} onPress={() => { onNavigate?.(); item.onPress(); }} style={({ pressed }) => [styles.item, listMode && styles.listItem, warning && styles.warningItem, normal && styles.normalItem, pathname === item.path && styles.selectedItem, pressed && styles.pressed]}>
      {item.label === 'Sparky AI' || item.label === 'Bill prediction' ? <SparkyPresence size={36} /> : item.label === 'Billing' ? <BillingNavIcon color={listMode ? item.tint : pathname === item.path ? selectedColor : idleColor} detailColor={colors.surface} size={27} /> : <Ionicons color={listMode ? item.tint : pathname === item.path ? selectedColor : idleColor} name={item.icon} size={24} />}
      {!listMode && pathname === item.path ? <View style={[styles.selectedDot, { backgroundColor: selectedColor }]} /> : null}
      {listMode ? <View style={styles.listCopy}><Text style={[styles.listLabel, { color: colors.text }]}>{item.label}</Text><Text style={[styles.listDetail, { color: warning ? colors.icons.alert : normal ? colors.icons.success : colors.textMuted }, (warning || normal) && { fontWeight: '700', fontSize: 12 }]}>{item.detail}</Text></View> : null}
      {listMode ? <Ionicons color={colors.textMuted} name="chevron-forward" size={21} /> : null}
    </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', borderRadius: 999, marginHorizontal: 58, marginBottom: 22, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, overflow: 'hidden' },
  listContainer: { flexDirection: 'column', borderRadius: 0, marginHorizontal: 16, marginBottom: 16, paddingVertical: 0, paddingHorizontal: 0, backgroundColor: 'transparent', borderWidth: 0, overflow: 'visible' },
  glassBackground: { ...StyleSheet.absoluteFill, borderRadius: 999 },
  glassTint: { ...StyleSheet.absoluteFill, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.03)' },
  item: { flex: 1, minHeight: 44, minWidth: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 999, position: 'relative' },
  listItem: { flex: 0, minHeight: 64, minWidth: 0, width: '100%', flexDirection: 'row', justifyContent: 'flex-start', gap: 14, paddingHorizontal: 12, borderRadius: 14 },
  warningItem: { borderWidth: 1.5, borderColor: palette.red, backgroundColor: 'rgba(232,33,39,0.14)', marginBottom: 6 },
  normalItem: { borderWidth: 1, borderColor: 'rgba(48,209,88,0.48)', backgroundColor: 'rgba(48,209,88,0.07)', marginBottom: 6 },
  listCopy: { flex: 1 },
  listLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  listDetail: { color: 'rgba(255,255,255,0.62)', fontSize: 11, marginTop: 2 },
  warningLabel: { color: '#FFFFFF' },
  warningDetail: { color: '#FFB8BA', fontSize: 12, fontWeight: '700' },
  normalDetail: { color: '#A2EFB8', fontSize: 12, fontWeight: '600' },
  selectedItem: { backgroundColor: 'transparent' },
  selectedDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF', position: 'absolute', bottom: 2 },
  pressed: { opacity: 0.58 },
});
