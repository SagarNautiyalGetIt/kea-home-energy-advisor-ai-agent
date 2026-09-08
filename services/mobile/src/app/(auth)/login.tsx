import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { ModalSheet } from '@/components/modal-sheet';
import { FormField, PrimaryButton } from '@/components/ui';
import { validateEmail, validateRequired } from '@/lib/validation';
import { requestPasswordReset } from '@/lib/account-api';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

type Errors = { email?: string; password?: string };

export default function LoginScreen() {
  const { colors } = useAppTheme();
  const { signIn } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetError, setResetError] = useState<string>();

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

  const sendReset = async () => {
    const issue = validateEmail(email);
    setResetError(issue);
    if (issue) return;
    try {
      await requestPasswordReset(email);
      setForgotOpen(false);
      showToast('Password reset instructions requested', 'info');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Password reset could not be requested.', 'warning');
    }
  };

  return (
    <AuthShell
      compact
      title="Login"
      subtitle="Enter your email and password to log in!"
      footer={<Text style={[styles.switchText, { color: colors.textMuted }]}>New to Kea Energy? <Link href="/register" style={styles.link}>Create an account</Link></Text>}>
      <FormField error={errors.email} keyboardType="email-address" label="Email *" onChangeText={(value) => { setEmail(value); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="name@example.com" value={email} />
      <FormField error={errors.password} label="Password *" onChangeText={(value) => { setPassword(value); setErrors((current) => ({ ...current, password: undefined })); }} placeholder="Min. 8 characters" secure value={password} />
      <Pressable hitSlop={8} onPress={() => setForgotOpen(true)}><Text style={styles.forgot}>Forgot password?</Text></Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember((value) => !value)} style={styles.rememberRow}><View style={[styles.checkbox, remember && styles.checkboxChecked]}>{remember ? <Ionicons color="#FFFFFF" name="checkmark" size={15} /> : null}</View><Text style={[styles.rememberText, { color: colors.text }]}>Keep me logged in</Text></Pressable>
      <PrimaryButton label="Login" loading={busy} onPress={() => void submit()} />
      <View style={styles.divider}><View style={[styles.dividerLine, { backgroundColor: colors.border }]} /><Text style={[styles.dividerText, { color: colors.textMuted }]}>or continue with</Text><View style={[styles.dividerLine, { backgroundColor: colors.border }]} /></View>
      <View style={styles.socialRow}>
        <Pressable onPress={() => showToast('Google sign-in is currently unavailable', 'info')} style={[styles.social, { borderColor: colors.border, backgroundColor: colors.surface }]}><Ionicons color={colors.text} name="logo-google" size={19} /><Text style={[styles.socialText, { color: colors.text }]}>Google</Text></Pressable>
        <Pressable onPress={() => showToast('Apple sign-in is currently unavailable', 'info')} style={[styles.social, { borderColor: colors.border, backgroundColor: colors.surface }]}><Ionicons color={colors.text} name="logo-apple" size={20} /><Text style={[styles.socialText, { color: colors.text }]}>Apple</Text></Pressable>
      </View>
      <ModalSheet footer={<PrimaryButton label="Send reset link" onPress={() => void sendReset()} />} onClose={() => setForgotOpen(false)} title="Reset password" visible={forgotOpen}>
        <Text style={[styles.modalCopy, { color: colors.textMuted }]}>Enter your account email to request a secure password reset link.</Text>
        <FormField error={resetError} keyboardType="email-address" label="Email address" onChangeText={(value) => { setEmail(value); setResetError(undefined); }} placeholder="name@example.com" value={email} />
      </ModalSheet>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', marginBottom: 2, color: palette.violet, fontSize: 15, fontWeight: '700' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  checkbox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#D8DEEC', borderRadius: 4 },
  checkboxChecked: { borderColor: palette.violet, backgroundColor: palette.violet },
  rememberText: { fontSize: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 2 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12.5 },
  socialRow: { flexDirection: 'row', gap: 10 },
  social: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 15 },
  socialText: { fontSize: 14, fontWeight: '700' },
  switchText: { marginTop: 18, fontSize: 14, textAlign: 'center' },
  link: { color: palette.violet, fontWeight: '900' },
  modalCopy: { marginBottom: 18, fontSize: 14, lineHeight: 21 },
});
