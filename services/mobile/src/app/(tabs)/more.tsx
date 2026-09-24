import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

import { loadDemoAccounts, type DemoAccount } from '@/lib/account-api';
import { useToast } from '@/providers/toast';

const menu = [
  { label: 'Plans', detail: 'Compare pricing and terms', icon: 'swap-horizontal-outline' as const, route: '/plans' as const },
  { label: 'Profile', detail: 'Contact and account details', icon: 'person-outline' as const, route: '/profile' as const },
  { label: 'Help & support', detail: 'Answers and Customer Care', icon: 'help-circle-outline' as const, route: '/help' as const },
  { label: 'Settings', detail: 'Alerts, privacy and security', icon: 'settings-outline' as const, route: '/settings' as const },
];

export default function MoreScreen() {
  const { colors } = useAppTheme();
  const { session, signIn, signOut } = useAuth();
  const { showToast } = useToast();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [switching, setSwitching] = useState(false);

  const logout = async () => { await signOut(); setLogoutOpen(false); router.replace('/login'); };

  const openDemoAccounts = async () => {
    setDemoOpen(true);
    try {
      setDemoAccounts(await loadDemoAccounts());
    } catch {
      // Handled inside loadDemoAccounts
    }
  };

  const switchAccount = async (account: DemoAccount) => {
    setSwitching(true);
    try {
      await signIn(account.email, account.password);
      setDemoOpen(false);
      showToast(`Switched to ${account.display_name}`, 'success');
      router.replace('/dashboard');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Could not switch account', 'warning');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Screen>
      <PageHeader title="More" subtitle="Your Kea Energy account" />
      <MotionPressable accessibilityLabel="Open profile" accessibilityRole="button" onPress={() => router.push('/profile')}>
        <Card style={styles.profileCard}>
          <Image source={require('../../../assets/kea/kea-profile.png')} style={styles.avatar} />
          <View style={styles.profileCopy}>
            <Text style={[styles.name, { color: colors.text }]}>{session?.displayName}</Text>
            <Text style={[styles.email, { color: colors.textMuted }]}>{session?.email} {session?.customerId ? `(${session.customerId})` : ''}</Text>
          </View>
          <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
        </Card>
      </MotionPressable>
      <SectionTitle>Account</SectionTitle>
      <Card style={styles.menuCard}>{menu.map((item, index) => <MotionPressable accessibilityRole="button" key={item.route} onPress={() => router.push(item.route)} style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }]}><View style={[styles.rowIcon, { backgroundColor: colors.input }]}><Ionicons color={colors.text} name={item.icon} size={21} /></View><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: colors.text }]}>{item.label}</Text><Text style={[styles.rowDetail, { color: colors.textMuted }]}>{item.detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={20} /></MotionPressable>)}</Card>
      <Pressable onPress={() => void openDemoAccounts()} style={[styles.switchDemo, { backgroundColor: colors.input, borderColor: colors.border }]}><Ionicons color={colors.text} name="people-outline" size={21} /><Text style={[styles.switchDemoText, { color: colors.text }]}>Switch demo account</Text></Pressable>
      <Pressable onPress={() => setLogoutOpen(true)} style={[styles.logout, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons color={palette.red} name="log-out-outline" size={21} /><Text style={styles.logoutText}>Sign out</Text></Pressable>
      <Text style={[styles.version, { color: colors.textMuted }]}>Kea Energy mobile · Version 1.0.0</Text>
      <ModalSheet footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setLogoutOpen(false)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Sign out" onPress={() => void logout()} variant="danger" /></View></View>} onClose={() => setLogoutOpen(false)} title="Sign out?" visible={logoutOpen}><Text style={[styles.modalText, { color: colors.textMuted }]}>Are you sure you want to sign out of your Kea Energy account?</Text></ModalSheet>
      <ModalSheet onClose={() => setDemoOpen(false)} title="Switch demo account" visible={demoOpen}>
        <Text style={[styles.demoIntro, { color: colors.textMuted }]}>Select a fixture household to test a different Kea scenario.</Text>
        <View style={styles.demoList}>
          {demoAccounts.map((account) => (
            <Pressable accessibilityRole="button" disabled={switching} key={account.customer_id} onPress={() => void switchAccount(account)} style={({ pressed }) => [styles.demoRow, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
              <View style={styles.demoCopy}>
                <Text style={[styles.demoName, { color: colors.text }]}>{account.display_name} ({account.customer_id})</Text>
                <Text style={[styles.demoScenario, { color: colors.textMuted }]}>{account.scenario}</Text>
              </View>
              <Text style={styles.demoUse}>Use</Text>
            </Pressable>
          ))}
        </View>
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenEnter: { flex: 1 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14 }, avatar: { width: 66, height: 66, borderRadius: 23 }, profileCopy: { flex: 1 }, name: { fontSize: 18, fontWeight: '900' }, email: { marginTop: 3, fontSize: 12 },
  menuCard: { paddingVertical: 1 }, row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, rowIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, rowCopy: { flex: 1 }, rowTitle: { fontSize: 14, fontWeight: '900' }, rowDetail: { marginTop: 3, fontSize: 11 }, pressed: { opacity: 0.65 },
  logout: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12, borderWidth: 1, borderRadius: 17 }, logoutText: { color: palette.red, fontSize: 14, fontWeight: '900' }, version: { marginTop: 18, fontSize: 10, textAlign: 'center' }, modalText: { fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 12 }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
  switchDemo: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 16, borderWidth: 1, borderRadius: 17 },
  switchDemoText: { fontSize: 14, fontWeight: '900' },
  demoIntro: { marginBottom: 12, fontSize: 12, lineHeight: 18 },
  demoList: { gap: 9 },
  demoRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
  demoCopy: { flex: 1 },
  demoName: { fontSize: 14, fontWeight: '900' },
  demoScenario: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  demoUse: { color: palette.green, fontSize: 13, fontWeight: '900', paddingHorizontal: 8 },
});
