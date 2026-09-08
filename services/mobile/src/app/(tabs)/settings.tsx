import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, FormField, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { changeAccountPassword, requestPasswordReset } from '@/lib/account-api';
import { getPhonePushToken, hasPhoneNotificationPermission, requestPhoneNotificationPermission } from '@/lib/notifications';
import { loadNotificationPreferences, registerPushToken, saveNotificationPreferences, unregisterPushToken, type NotificationPreferences } from '@/lib/settings-api';
import { validateEmail, validateNewPassword, validateRequired } from '@/lib/validation';
import { useToast } from '@/providers/toast';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

type Preferences = NotificationPreferences;
type SettingsModal = 'privacy' | 'security' | 'change-password' | 'reset-email' | null;
type PasswordErrors = { current?: string; next?: string; confirm?: string };

const defaults: Preferences = { emailNotifications: true, smsNotifications: false, phoneNotifications: false };

export default function SettingsScreen() {
  const { colors, mode, setMode } = useAppTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const [preferences, setPreferences] = useState(defaults);
  const [modal, setModal] = useState<SettingsModal>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [resetEmail, setResetEmail] = useState(session?.email ?? '');
  const [resetEmailError, setResetEmailError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!session?.customerId) return;
        const next = await loadNotificationPreferences(session.customerId);
        if (next.phoneNotifications && !(await hasPhoneNotificationPermission())) next.phoneNotifications = false;
        if (active) setPreferences(next);
      } catch {
        // Defaults are safe when stored preferences or native permissions are unavailable.
      }
    })();
    return () => { active = false; };
  }, [session?.customerId]);

  const update = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if (!session?.customerId) return;
    void saveNotificationPreferences(session.customerId, next).catch((error: unknown) => {
      setPreferences(preferences);
      showToast(error instanceof Error ? error.message : 'Notification preferences could not be saved.', 'warning');
    });
  };

  const closePasswordEditor = () => {
    setModal(null);
    setCurrentPassword('');
    setNextPassword('');
    setConfirmPassword('');
    setPasswordErrors({});
  };

  const togglePhoneNotifications = async () => {
    if (preferences.phoneNotifications) {
      if (session?.customerId) {
        const token = await getPhonePushToken().catch(() => null);
        if (token) await unregisterPushToken(session.customerId, token).catch(() => undefined);
      }
      update({ phoneNotifications: false });
      return;
    }
    const result = await requestPhoneNotificationPermission();
    if (result === 'granted') {
      if (!session?.customerId) {
        showToast('Please sign in again to enable phone notifications.', 'warning');
        return;
      }
      try {
        const token = await getPhonePushToken();
        if (!token) throw new Error('A push token could not be created on this device.');
        await registerPushToken(session.customerId, token, Platform.OS);
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : 'Phone notifications could not be registered.', 'warning');
        return;
      }
      update({ phoneNotifications: true });
      showToast('Phone notifications enabled', 'success');
      return;
    }
    update({ phoneNotifications: false });
    showToast(result === 'denied' ? 'Phone permission was not granted. In-app alerts remain available.' : 'Phone notifications can be enabled from the iOS or Android app.', 'warning');
  };

  const changePassword = async () => {
    const errors: PasswordErrors = {
      current: validateRequired(currentPassword, 'Current password'),
      next: validateNewPassword(nextPassword),
      confirm: confirmPassword === nextPassword ? undefined : 'Passwords do not match.',
    };
    setPasswordErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await changeAccountPassword(session?.customerId ?? '', currentPassword, nextPassword);
      closePasswordEditor();
      showToast('Password updated successfully', 'success');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Password could not be updated.', 'warning');
    }
  };

  const sendReset = async () => {
    const error = validateEmail(resetEmail);
    setResetEmailError(error);
    if (error) return;
    try {
      await requestPasswordReset(resetEmail);
      setModal(null);
      showToast(`Password reset link requested for ${resetEmail.trim()}`, 'info');
    } catch (requestError: unknown) {
      showToast(requestError instanceof Error ? requestError.message : 'Password reset could not be requested.', 'warning');
    }
  };

  return (
    <Screen>
      <PageHeader title="Settings" subtitle="Appearance, alerts and privacy" />
      <SectionTitle>Appearance</SectionTitle>
      <Card>
        <View style={styles.modeRow}>{(['light', 'dark'] as const).map((item) => { const active = mode === item; return <Pressable key={item} onPress={() => { setMode(item); showToast(`${item === 'light' ? 'Light' : 'Dark'} appearance enabled`, 'info'); }} style={[styles.modeOption, { backgroundColor: active ? palette.violet : colors.input, borderColor: active ? palette.violet : colors.border }]}><Ionicons color={active ? '#FFFFFF' : colors.textMuted} name={item === 'light' ? 'sunny-outline' : 'moon-outline'} size={22} /><Text style={[styles.modeText, { color: active ? '#FFFFFF' : colors.text }]}>{item === 'light' ? 'Light' : 'Dark'}</Text></Pressable>; })}</View>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card style={styles.settingsCard}>
        <NotificationChannel checked={preferences.emailNotifications} colors={colors} detail="Receive account notices by email" icon="mail-outline" label="Email" onPress={() => update({ emailNotifications: !preferences.emailNotifications })} />
        <NotificationChannel checked={preferences.smsNotifications} colors={colors} detail="Receive short alerts by text message" icon="chatbox-outline" label="SMS" onPress={() => update({ smsNotifications: !preferences.smsNotifications })} />
        <NotificationChannel checked={preferences.phoneNotifications} colors={colors} detail="Receive notifications on this phone" icon="phone-portrait-outline" label="Phone" onPress={() => void togglePhoneNotifications()} />
      </Card>

      <SectionTitle>Privacy and security</SectionTitle>
      <Card style={styles.settingsCard}>
        <SettingLink colors={colors} detail="How Kea handles account information" icon="shield-half-outline" label="Privacy and data" onPress={() => setModal('privacy')} />
        <SettingLink colors={colors} detail="Change your password or request a reset link" icon="lock-closed-outline" label="Password and security" onPress={() => setModal('security')} />
      </Card>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setModal(null)} />} onClose={() => setModal(null)} title="Privacy and data" visible={modal === 'privacy'}>
        <Text style={[styles.modalText, { color: colors.textMuted }]}>Kea Energy uses account, contact, usage, billing and support information to provide and improve your energy service.</Text><Text style={[styles.modalHeading, { color: colors.text }]}>Your rights</Text>{['Request access to your personal information.', 'Ask for incorrect information to be corrected.', 'Understand how your information is used.', 'Request support from a person.'].map((item) => <View key={item} style={styles.bullet}><Ionicons color={palette.green} name="checkmark-circle" size={18} /><Text style={[styles.bulletText, { color: colors.textMuted }]}>{item}</Text></View>)}
      </ModalSheet>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setModal(null)} />} onClose={() => setModal(null)} title="Password and security" visible={modal === 'security'}>
        <View style={styles.securityHero}><View style={styles.securityIcon}><Ionicons color={palette.violet} name="lock-closed-outline" size={29} /></View><Text style={[styles.securityTitle, { color: colors.text }]}>Protect your account</Text><Text style={[styles.securityIntro, { color: colors.textMuted }]}>Choose how you want to update or reset your password.</Text></View>
        <View style={styles.securityActions}>
          <SettingLink colors={colors} detail="Enter your current password and choose a new one" icon="key-outline" label="Change password" onPress={() => setModal('change-password')} />
          <SettingLink colors={colors} detail="Enter an email address to request a secure reset link" icon="mail-outline" label="Email reset link" onPress={() => { setResetEmailError(undefined); setModal('reset-email'); }} />
        </View>
      </ModalSheet>

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={closePasswordEditor} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Change password" onPress={() => void changePassword()} /></View></View>} keyboardAware onClose={closePasswordEditor} title="Change password" visible={modal === 'change-password'}>
        <View style={styles.form}>
          <Text style={[styles.formIntro, { color: colors.textMuted }]}>Use at least 8 characters for your new password.</Text>
          <FormField error={passwordErrors.current} label="Current password" onChangeText={(value) => { setCurrentPassword(value); setPasswordErrors((errors) => ({ ...errors, current: undefined })); }} placeholder="Enter current password" secure value={currentPassword} />
          <FormField error={passwordErrors.next} label="New password" onChangeText={(value) => { setNextPassword(value); setPasswordErrors((errors) => ({ ...errors, next: undefined })); }} placeholder="At least 8 characters" secure value={nextPassword} />
          <FormField error={passwordErrors.confirm} label="Confirm new password" onChangeText={(value) => { setConfirmPassword(value); setPasswordErrors((errors) => ({ ...errors, confirm: undefined })); }} placeholder="Re-enter new password" secure value={confirmPassword} />
        </View>
      </ModalSheet>

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setModal(null)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton icon="mail-outline" label="Send reset link" onPress={() => void sendReset()} /></View></View>} keyboardAware onClose={() => setModal(null)} title="Reset password by email" visible={modal === 'reset-email'}>
        <View style={styles.form}>
          <View style={styles.resetIcon}><Ionicons color={palette.violet} name="mail-outline" size={27} /></View>
          <Text style={[styles.formIntro, { color: colors.textMuted }]}>Enter the account email that should receive password reset instructions.</Text>
          <FormField error={resetEmailError} keyboardType="email-address" label="Email address" onChangeText={(value) => { setResetEmail(value); setResetEmailError(undefined); }} placeholder="name@example.com" value={resetEmail} />
        </View>
      </ModalSheet>
    </Screen>
  );
}

function NotificationChannel({ colors, icon, label, detail, checked, onPress }: { colors: ReturnType<typeof useAppTheme>['colors']; icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><View style={styles.settingIcon}><Ionicons color={palette.violet} name={icon} size={20} /></View><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><View style={[styles.checkbox, { borderColor: checked ? palette.violet : colors.border, backgroundColor: checked ? palette.violet : 'transparent' }]}>{checked ? <Ionicons color="#FFFFFF" name="checkmark" size={17} /> : null}</View></Pressable>;
}

function SettingLink({ colors, icon, label, detail, onPress }: { colors: ReturnType<typeof useAppTheme>['colors']; icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><View style={styles.settingIcon}><Ionicons color={palette.violet} name={icon} size={20} /></View><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={20} /></Pressable>;
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 10 }, modeOption: { flex: 1, minHeight: 82, alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 17 }, modeText: { fontSize: 12, fontWeight: '900' },
  settingsCard: { paddingVertical: 2 }, settingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, paddingVertical: 12 }, settingIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#F0EDFF' }, settingCopy: { flex: 1 }, settingTitle: { fontSize: 13, fontWeight: '900' }, settingDetail: { marginTop: 3, fontSize: 10, lineHeight: 14 }, checkbox: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 8 }, notificationNote: { paddingVertical: 12, fontSize: 10, lineHeight: 15 }, pressed: { opacity: 0.68 },
  dataMode: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 14 }, dataIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E7F8F1' }, dataCopy: { flex: 1 }, dataTitle: { fontSize: 12, fontWeight: '900' }, dataBody: { marginTop: 3, fontSize: 10, lineHeight: 14 }, activeBadge: { borderRadius: 8, backgroundColor: '#E7F8F1', paddingHorizontal: 7, paddingVertical: 4 }, activeText: { color: palette.green, fontSize: 8, fontWeight: '900' },
  modalText: { fontSize: 13, lineHeight: 21 }, modalHeading: { marginTop: 20, marginBottom: 10, fontSize: 16, fontWeight: '900' }, bullet: { flexDirection: 'row', gap: 8, marginVertical: 7 }, bulletText: { flex: 1, fontSize: 12, lineHeight: 18 },
  securityHero: { alignItems: 'center', paddingVertical: 10 }, securityIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#F0EDFF' }, securityTitle: { marginTop: 15, fontSize: 17, fontWeight: '900' }, securityIntro: { marginTop: 6, fontSize: 12, lineHeight: 18, textAlign: 'center' }, securityActions: { marginTop: 10 }, securityNote: { marginTop: 14, fontSize: 10, lineHeight: 16 },
  form: { gap: 16 }, formIntro: { fontSize: 12, lineHeight: 18 }, resetIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 18, backgroundColor: '#F0EDFF' }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
});
