import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

const menu = [
  { label: 'Plans', detail: 'Compare pricing and terms', icon: 'swap-horizontal-outline' as const, route: '/plans' as const },
  { label: 'Profile', detail: 'Contact and account details', icon: 'person-outline' as const, route: '/profile' as const },
  { label: 'Help & support', detail: 'Answers and Customer Care', icon: 'help-circle-outline' as const, route: '/help' as const },
  { label: 'Settings', detail: 'Appearance, alerts and privacy', icon: 'settings-outline' as const, route: '/settings' as const },
];

export default function MoreScreen() {
  const { colors } = useAppTheme();
  const { session, signOut } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const logout = async () => { await signOut(); setLogoutOpen(false); router.replace('/login'); };
  return (
    <Screen>
      <PageHeader title="More" subtitle="Your Kea Energy account" />
      <Card style={styles.profileCard}>
        <Image source={require('../../../assets/kea/kea-profile.png')} style={styles.avatar} />
        <View style={styles.profileCopy}><Text style={[styles.name, { color: colors.text }]}>{session?.displayName}</Text><Text style={[styles.email, { color: colors.textMuted }]}>{session?.email}</Text></View>
      </Card>
      <SectionTitle>Account</SectionTitle>
      <Card style={styles.menuCard}>{menu.map((item, index) => <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }, pressed && styles.pressed]}><View style={styles.rowIcon}><Ionicons color={palette.violet} name={item.icon} size={21} /></View><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: colors.text }]}>{item.label}</Text><Text style={[styles.rowDetail, { color: colors.textMuted }]}>{item.detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={20} /></Pressable>)}</Card>
      <Pressable onPress={() => setLogoutOpen(true)} style={[styles.logout, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons color={palette.red} name="log-out-outline" size={21} /><Text style={styles.logoutText}>Sign out</Text></Pressable>
      <Text style={[styles.version, { color: colors.textMuted }]}>Kea Energy mobile · Version 1.0.0</Text>
      <ModalSheet footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setLogoutOpen(false)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Sign out" onPress={() => void logout()} variant="danger" /></View></View>} onClose={() => setLogoutOpen(false)} title="Sign out?" visible={logoutOpen}><Text style={[styles.modalText, { color: colors.textMuted }]}>Are you sure you want to sign out of your Kea Energy account?</Text></ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14 }, avatar: { width: 66, height: 66, borderRadius: 23 }, profileCopy: { flex: 1 }, name: { fontSize: 18, fontWeight: '900' }, email: { marginTop: 3, fontSize: 12 },
  menuCard: { paddingVertical: 1 }, row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, rowIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F0EDFF' }, rowCopy: { flex: 1 }, rowTitle: { fontSize: 14, fontWeight: '900' }, rowDetail: { marginTop: 3, fontSize: 11 }, pressed: { opacity: 0.65 },
  logout: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 16, borderWidth: 1, borderRadius: 17 }, logoutText: { color: palette.red, fontSize: 14, fontWeight: '900' }, version: { marginTop: 18, fontSize: 10, textAlign: 'center' }, modalText: { fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 12 }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
});
