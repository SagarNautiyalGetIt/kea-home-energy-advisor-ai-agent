import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAppTheme } from '@/theme';

function WebsiteAuthLogo({ size = 78 }: { size?: number }) {
  return (
    <Svg accessibilityLabel="Kea Energy" height={size} viewBox="0 0 256 256" width={size}>
      <Path d="M33.0001 128C32.9752 107.356 39.6759 87.2648 52.088 70.7683C64.5002 54.2718 81.9483 42.2676 101.792 36.5722C121.635 30.8768 142.794 31.8004 162.065 39.2031C181.337 46.6058 197.673 60.0848 208.6 77.6" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={15} />
      <Path d="M226 96L222 68L197 85L226 96Z" fill="#FFFFFF" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={5} />
      <Path d="M223 128C223.025 148.644 216.324 168.735 203.912 185.232C191.5 201.728 174.052 213.732 154.208 219.428C134.365 225.123 113.206 224.2 93.9348 216.797C74.6632 209.394 58.3275 195.915 47.3999 178.4" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={15} />
      <Path d="M30 160L34 188L59 171L30 160Z" fill="#FFFFFF" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={5} />
      <Path d="M144.5 46.6L137.9 108.2L170.35 118.54C178.783 121.18 180.103 125.763 174.31 132.29L107.1 208.3L115.9 151.1L85.0999 140.54C77.7665 138.047 77.0332 133.06 82.8999 125.58L144.5 46.6Z" fill="#FFFFFF" stroke="#FFFFFF" strokeLinejoin="round" />
    </Svg>
  );
}

export function AuthShell({ title, subtitle, children, footer, compact = false }: { title: string; subtitle?: string; children: ReactNode; footer: ReactNode; compact?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.surface }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.scroll, { backgroundColor: colors.surface }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, compact && styles.heroCompact]}>
            <View style={[styles.brand, compact && styles.brandCompact]}><WebsiteAuthLogo size={compact ? 68 : 78} /><Text style={[styles.brandName, compact && styles.brandNameCompact]}>KEA ENERGY</Text></View>
          </View>
          <View style={[styles.panel, compact && styles.panelCompact, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, compact && styles.titleCompact, { color: colors.text }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, compact && styles.subtitleCompact, { color: colors.textMuted }]}>{subtitle}</Text> : null}
            <View style={[styles.form, compact && styles.formCompact]}>{children}</View>
            {footer}
            <Text style={[styles.legal, { color: colors.textMuted }]}>© 2026 Kea Energy. All rights reserved.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  hero: { width: '100%', maxWidth: 760, minHeight: 170, alignItems: 'center', justifyContent: 'center', borderBottomRightRadius: 68, overflow: 'hidden', backgroundColor: '#000000' },
  heroCompact: { minHeight: 140, borderBottomRightRadius: 56 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  brandCompact: { gap: 13 },
  brandName: { color: '#FFFFFF', fontSize: 40, lineHeight: 42, fontWeight: '900', letterSpacing: -1.8 },
  brandNameCompact: { fontSize: 35, lineHeight: 37, letterSpacing: -1.4 },
  panel: { width: '100%', maxWidth: 760, flex: 1, paddingHorizontal: 24, paddingTop: 38, paddingBottom: 20 },
  panelCompact: { paddingTop: 26, paddingBottom: 16 },
  title: { fontSize: 42, lineHeight: 44, fontWeight: '900', letterSpacing: -1.8 },
  titleCompact: { fontSize: 38, lineHeight: 40, letterSpacing: -1.5 },
  subtitle: { marginTop: 16, fontSize: 17, lineHeight: 23 },
  subtitleCompact: { marginTop: 10, fontSize: 16, lineHeight: 22 },
  form: { marginTop: 30, gap: 14 },
  formCompact: { marginTop: 22, gap: 12 },
  legal: { marginTop: 22, fontSize: 11, textAlign: 'center' },
});
