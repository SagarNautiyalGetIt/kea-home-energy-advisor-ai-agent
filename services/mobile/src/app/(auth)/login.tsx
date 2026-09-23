import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { ModalSheet } from '@/components/modal-sheet';
import { FormField, PrimaryButton } from '@/components/ui';
import { loadDemoAccounts, type DemoAccount } from '@/lib/account-api';
import { validateEmail, validateRequired } from '@/lib/validation';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { useAppTheme } from '@/theme';

type Errors = { email?: string; password?: string };

export default function LoginScreen() {
  const { colors } = useAppTheme();
  const { signIn } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  const submit = async () => {
    const next = { email: validateEmail(email), password: validateRequired(password, 'Password') };
    setErrors(next);
    if (next.email || next.password) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/dashboard');
    } catch (error: unknown) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error instanceof Error ? error.message : 'Sign in could not be completed.', 'warning');
    } finally {
      setBusy(false);
    }
  };

  const openDemoAccounts = async () => {
    setDemoOpen(true);
    setDemoLoading(true);
    try {
      setDemoAccounts(await loadDemoAccounts());
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Demo accounts could not be loaded.', 'warning');
    } finally {
      setDemoLoading(false);
    }
  };

  const signInAsDemo = async (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setBusy(true);
    try {
      await signIn(account.email, account.password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDemoOpen(false);
      router.replace('/dashboard');
    } catch (error: unknown) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error instanceof Error ? error.message : 'Demo sign-in could not be completed.', 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      compact
      title="Login"
      subtitle="Sign in to your Kea account."
      footer={null}>
      <FormField error={errors.email} keyboardType="email-address" label="Email *" onChangeText={(value) => { setEmail(value); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="name@example.com" value={email} />
      <FormField error={errors.password} label="Password *" onChangeText={(value) => { setPassword(value); setErrors((current) => ({ ...current, password: undefined })); }} placeholder="Min. 8 characters" secure value={password} />
      <PrimaryButton label="Login" loading={busy} onPress={() => void submit()} />
      <PrimaryButton icon="people-outline" label="Choose a demo account" onPress={() => void openDemoAccounts()} variant="secondary" />
      <ModalSheet onClose={() => setDemoOpen(false)} title="Choose a demo account" visible={demoOpen}>
        <Text style={[styles.demoIntro, { color: colors.textMuted }]}>Select a fixture household to test a different Kea scenario.</Text>
        {demoLoading ? <Text style={[styles.demoIntro, { color: colors.textMuted }]}>Loading demo accounts…</Text> : null}
        <View style={styles.demoList}>{demoAccounts.map((account) => <Pressable accessibilityRole="button" disabled={busy} key={account.customer_id} onPress={() => void signInAsDemo(account)} style={({ pressed }) => [styles.demoRow, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}><View style={styles.demoCopy}><Text style={[styles.demoName, { color: colors.text }]}>{account.display_name}</Text><Text style={[styles.demoScenario, { color: colors.textMuted }]}>{account.scenario}</Text></View><Text style={styles.demoUse}>Use</Text></Pressable>)}</View>
      </ModalSheet>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  demoIntro: { marginBottom: 12, fontSize: 12, lineHeight: 18 },
  demoList: { gap: 9 },
  demoRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
  demoCopy: { flex: 1 },
  demoName: { fontSize: 13, fontWeight: '900' },
  demoScenario: { marginTop: 3, fontSize: 10, lineHeight: 15 },
  demoUse: { color: '#000000', borderRadius: 9, backgroundColor: '#FFFFFF', paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: '900' },
  pressed: { opacity: 0.68 },
});
