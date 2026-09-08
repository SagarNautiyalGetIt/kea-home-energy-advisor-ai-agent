import * as Haptics from 'expo-haptics';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { FormField, PrimaryButton } from '@/components/ui';
import { validateEmail, validateNewPassword, validateRequired } from '@/lib/validation';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

type Errors = { name?: string; email?: string; password?: string; confirm?: string };

export default function RegisterScreen() {
  const { colors } = useAppTheme();
  const { signUp } = useAuth();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: Errors = {
      name: validateRequired(name, 'Full name'),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: confirm === password ? undefined : 'Passwords do not match.',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    try {
      await signUp(name, email, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/dashboard');
    } catch (error: unknown) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error instanceof Error ? error.message : 'Account could not be created.', 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign up" footer={<Text style={[styles.switchText, { color: colors.textMuted }]}>Already have an account? <Link href="/login" style={styles.link}>Log in</Link></Text>}>
      <FormField autoCapitalize="words" error={errors.name} label="Full name *" onChangeText={(value) => { setName(value); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="Full name" value={name} />
      <FormField error={errors.email} keyboardType="email-address" label="Email address *" onChangeText={(value) => { setEmail(value); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="name@example.com" value={email} />
      <FormField error={errors.password} label="Password *" onChangeText={(value) => { setPassword(value); setErrors((current) => ({ ...current, password: undefined })); }} placeholder="Min. 8 characters" secure value={password} />
      <FormField error={errors.confirm} label="Confirm password *" onChangeText={(value) => { setConfirm(value); setErrors((current) => ({ ...current, confirm: undefined })); }} placeholder="Re-enter your password" secure value={confirm} />
      <PrimaryButton label="Create account" loading={busy} onPress={() => void submit()} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  switchText: { marginTop: 24, fontSize: 14, textAlign: 'center' },
  link: { color: palette.violet, fontWeight: '900' },
});
