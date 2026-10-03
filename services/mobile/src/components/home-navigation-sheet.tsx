import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useRef, useState, type RefObject } from 'react';
import { Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { BottomNavigation } from './bottom-navigation';
import { tactile } from '@/lib/haptics';
import { useAppTheme } from '@/theme';

export function HomeNavigationSheet({ billPrediction, blurTarget }: { blurTarget: RefObject<View | null>; billPrediction: { detail: string; onPress: () => void; status?: 'warning' | 'normal' } }) {
  const { colors, mode } = useAppTheme();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);
  const show = () => { tactile(); setOpen(true); };
  const hide = () => setOpen(false);
  const dock = PanResponder.create({ onMoveShouldSetPanResponderCapture: (_, g) => g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx), onPanResponderRelease: (_, g) => { if (g.dy < -30) show(); } });
  const handle = PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx), onPanResponderRelease: (_, g) => { if (g.dy > 35) hide(); } });
  return <>
    <View {...dock.panHandlers} style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}><Pressable accessibilityRole="button" accessibilityLabel="Open Home navigation" accessibilityHint="Swipe up or activate to show Kea pages" accessibilityState={{ expanded: open }} onPress={show}>
      <View style={[styles.grabber, { backgroundColor: colors.border }]} />
      <View style={styles.dockRow}><Ionicons name="apps-outline" color={colors.icons.info} size={22} /><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.text }]}>Explore Kea</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>Swipe up · predictions, usage, Sparky and more</Text></View><Ionicons name="chevron-up" color={colors.icons.energy} size={22} /></View>
    </Pressable></View>
    <Modal visible={open} transparent presentationStyle="overFullScreen" animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={hide} onDismiss={() => { const next = afterDismiss.current; afterDismiss.current = null; next?.(); }}>
      <View style={styles.modal}>
        <BlurView pointerEvents="none" blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={65} tint={mode} style={StyleSheet.absoluteFill} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close Home navigation" onPress={hide} style={[StyleSheet.absoluteFill, { backgroundColor: mode === 'dark' ? 'rgba(17,17,17,0.28)' : 'rgba(245,245,245,0.25)' }]} />
        <View accessibilityViewIsModal style={[styles.sheet, { height: Math.min(height * 0.76, 690), backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <View {...handle.panHandlers} style={styles.header}><View style={[styles.grabber, { backgroundColor: colors.border }]} /><View style={styles.dockRow}><Text style={[styles.heading, { color: colors.text }]}>Your Kea shortcuts</Text><Pressable accessibilityRole="button" accessibilityLabel="Close shortcuts" onPress={hide} style={styles.close}><Ionicons name="close" color={colors.textMuted} size={24} /></Pressable></View></View>
          <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 30 }}><BottomNavigation listMode includeHome={false} onNavigate={hide} billPrediction={{ ...billPrediction, onPress: () => { if (Platform.OS === 'ios') afterDismiss.current = billPrediction.onPress; hide(); if (Platform.OS !== 'ios') billPrediction.onPress(); } }} /></ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({ dock: { margin: 16, borderWidth: 1, borderRadius: 22, padding: 16, paddingTop: 9 }, grabber: { width: 42, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 10 }, dockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { fontSize: 16, fontWeight: '800', marginBottom: 3 }, modal: { flex: 1, justifyContent: 'flex-end' }, sheet: { width: '100%', maxWidth: 760, alignSelf: 'center', borderWidth: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }, header: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6 }, heading: { fontSize: 20, fontWeight: '800', flex: 1 }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' } });
