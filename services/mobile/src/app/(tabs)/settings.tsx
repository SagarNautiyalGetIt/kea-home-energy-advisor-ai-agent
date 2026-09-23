import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, FormField, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { changeAccountPassword, requestPasswordReset } from '@/lib/account-api';
import { apiJson, jsonRequest } from '@/lib/backend-client';
import { loadNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from '@/lib/settings-api';
import { validateEmail, validateNewPassword, validateRequired } from '@/lib/validation';
import { useToast } from '@/providers/toast';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

type Preferences = NotificationPreferences;
type SettingsModal = 'privacy' | 'security' | 'change-password' | 'reset-email' | null;
type PasswordErrors = { current?: string; next?: string; confirm?: string };

const defaults: Preferences = { accountRef: '', enabled: true, emailNotifications: true, smsNotifications: false, phoneNotifications: false, billReminders: true, tier1Pct: 15, tier2Pct: 40, tier3Pct: 75, minOvershootNzd: 20, offlineModelOptIn: false, email: null, phoneE164: null, quietHoursStart: 21, quietHoursEnd: 8, timezone: 'Pacific/Auckland', theme: 'dark' };
const tierOptions = { email: [10, 15, 20, 30, 40], sms: [40, 50, 60, 70], phone: [70, 75, 80, 90, 100] } as const;
type ScanResult = { devices_found?: number; devices?: { name?: string; kind?: string; note?: string }[]; error?: string | null };

export default function SettingsScreen() {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const [preferences, setPreferences] = useState<Preferences>(() => ({ ...defaults, accountRef: session?.customerId ?? '' }));
  const [modal, setModal] = useState<SettingsModal>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [resetEmail, setResetEmail] = useState(session?.email ?? '');
  const [resetEmailError, setResetEmailError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [offlineDownloadMb, setOfflineDownloadMb] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!session?.customerId) return;
        const next = await loadNotificationPreferences(session.customerId);
        if (active) setPreferences(next);
      } catch {
        // Defaults are safe when stored preferences or native permissions are unavailable.
      }
    })();
    return () => { active = false; };
  }, [session?.customerId]);

  useEffect(() => {
    let active = true;
    void apiJson<{ download_mb?: number }[]>('/api/offline/models').then((models) => {
      const sizes = models.map((model) => model.download_mb).filter((size): size is number => typeof size === 'number');
      if (active && sizes.length) setOfflineDownloadMb(Math.min(...sizes));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

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

  const scanNetwork = async () => {
    setScanning(true);
    try {
      const result = await apiJson<ScanResult>('/api/homelink/discover', jsonRequest('POST'));
      setScan(result);
      showToast(result.devices_found ? `Found ${result.devices_found} devices` : 'No devices answered on this network', 'info');
    } catch (error) {
      setScan({ error: error instanceof Error ? error.message : 'The scan could not be started.' });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Screen>
      <PageHeader title="Settings" subtitle="Manage your account preferences and privacy." />

      <SectionTitle>Bill-shock alerts</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>You choose how far over your bill has to be tracking before we get in touch, and how.</Text>
      <Card style={styles.settingsCard}>
        <NotificationChannel checked={preferences.enabled} colors={colors} detail="Tell me when this cycle is heading somewhere I would not expect. The warning still shows in the app when this is off." icon="notifications-outline" label="Bill-shock alerts" onPress={() => update({ enabled: !preferences.enabled })} />
        <Text style={[styles.groupLabel, { color: colors.textMuted }]}>HOW WE TELL YOU, AND HOW FAR OVER IS FAR ENOUGH</Text>
        <ThresholdChannel checked={preferences.emailNotifications} colors={colors} label="Email" note="Always in writing, so you have a record." options={tierOptions.email} onToggle={() => update({ emailNotifications: !preferences.emailNotifications })} onValue={(tier1Pct) => update({ tier1Pct })} value={preferences.tier1Pct} />
        <ThresholdChannel checked={preferences.smsNotifications} colors={colors} label="Text message" note="Interrupts your day — set this higher than the email." options={tierOptions.sms} onToggle={() => update({ smsNotifications: !preferences.smsNotifications })} onValue={(tier2Pct) => update({ tier2Pct })} value={preferences.tier2Pct} />
        <ThresholdChannel checked={preferences.phoneNotifications} colors={colors} label="A call from Sparky" note="Sparky calls you. Off unless you turn it on." options={tierOptions.phone} onToggle={() => update({ phoneNotifications: !preferences.phoneNotifications })} onValue={(tier3Pct) => update({ tier3Pct })} value={preferences.tier3Pct} />
        <NumberSetting colors={colors} detail="This is the dollar floor underneath every alert level above." label="Never alert me under" max={500} onValue={(minOvershootNzd) => update({ minOvershootNzd })} prefix="$" value={preferences.minOvershootNzd} />
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>Quiet hours</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>Texts and calls wait until morning. Emails still arrive.</Text></View><View style={styles.quietInputs}><HourInput colors={colors} onValue={(quietHoursStart) => update({ quietHoursStart })} value={preferences.quietHoursStart ?? 21} /><Text style={{ color: colors.textMuted }}>to</Text><HourInput colors={colors} onValue={(quietHoursEnd) => update({ quietHoursEnd })} value={preferences.quietHoursEnd ?? 8} /></View></View>
        <NotificationChannel checked={preferences.offlineModelOptIn} colors={colors} detail={`Keep a small assistant on this device so Sparky can work without a connection.${offlineDownloadMb === null ? '' : ` About ${Math.round(offlineDownloadMb)} MB, downloaded over Wi-Fi only.`}`} icon="cloud-offline-outline" label="Answers without a connection" onPress={() => update({ offlineModelOptIn: !preferences.offlineModelOptIn })} />
        <View style={styles.saveButton}><PrimaryButton label="Save alert settings" onPress={() => session?.customerId && void saveNotificationPreferences(session.customerId, preferences).then(() => showToast('Alert settings saved', 'success')).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Alert settings could not be saved.', 'warning'))} /></View>
        <NotificationChannel checked={preferences.billReminders} colors={colors} detail="Receive reminders before a bill is due." icon="calendar-outline" label="Bill reminders" onPress={() => update({ billReminders: !preferences.billReminders })} />
      </Card>

      <SectionTitle>Connected home</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Find the smart devices on your network, so your bill explanation can name them.</Text>
      <Card style={styles.connectedCard}>
        <View style={styles.connectedTitle}><Ionicons color={colors.text} name="radio-outline" size={22} /><Text style={[styles.modalHeading, { color: colors.text }]}>Smart devices on your network</Text></View>
        <Text style={[styles.modalText, { color: colors.textMuted }]}>We can look for devices already announcing themselves on your home network. This tells us what you have; it does not read how much power they use.</Text>
        <Pressable disabled={scanning} onPress={() => void scanNetwork()} style={styles.scanButton}>{scanning ? <ActivityIndicator color="#000000" /> : <Ionicons color="#000000" name="wifi-outline" size={18} />}<Text style={styles.scanButtonText}>{scanning ? 'Scanning…' : 'Scan my network'}</Text></Pressable>
        {scan?.error ? <Text style={[styles.scanResult, { color: palette.red }]}>The scan couldn’t run here — {scan.error}</Text> : null}
        {scan && !scan.error && !scan.devices_found ? <Text style={[styles.scanResult, { color: colors.textMuted }]}>Nothing answered. This may happen when you’re away from home, on mobile data, or using a guest network.</Text> : null}
        {scan?.devices?.map((device, index) => <View key={`${device.name}-${index}`} style={[styles.deviceRow, { borderTopColor: colors.border }]}><Text style={[styles.settingTitle, { color: colors.text }]}>{device.name ?? 'Smart device'}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{device.kind}{device.note ? ` · ${device.note}` : ''}</Text></View>)}
        <Text style={[styles.footnote, { color: colors.textMuted }]}>Nothing found here is stored. Apple Home is read locally by the phone.</Text>
      </Card>

      <SectionTitle>Account security</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Review your data and keep your account protected.</Text>
      <Card style={styles.settingsCard}>
        <SettingLink colors={colors} detail="Review how your account information is used." icon="shield-half-outline" label="Privacy and data" onPress={() => setModal('privacy')} />
        <SettingLink colors={colors} detail="Reset your password and protect your account." icon="lock-closed-outline" label="Password and security" onPress={() => setModal('security')} />
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
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><View style={[styles.settingIcon, { backgroundColor: colors.input }]}><Ionicons color={colors.text} name={icon} size={20} /></View><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><View style={[styles.checkbox, { borderColor: checked ? palette.white : colors.border, backgroundColor: checked ? palette.white : 'transparent' }]}>{checked ? <Ionicons color="#000000" name="checkmark" size={17} /> : null}</View></Pressable>;
}

function ThresholdChannel({ colors, label, note, checked, value, options, onToggle, onValue }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; note: string; checked: boolean; value: number; options: readonly number[]; onToggle: () => void; onValue: (value: number) => void }) {
  const visibleOptions = options.includes(value) ? options : [...options, value].sort((left, right) => left - right);
  const minimum = visibleOptions[0] ?? 0;
  const maximum = visibleOptions.at(-1) ?? 100;
  const ratio = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
  return <View style={[styles.thresholdBlock, { borderBottomColor: colors.border }, !checked && styles.disabledChannel]}><View style={styles.thresholdHeader}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Pressable accessibilityRole="switch" accessibilityState={{ checked }} onPress={onToggle} style={[styles.switchTrack, { backgroundColor: checked ? '#0A84FF' : colors.border }]}><View style={[styles.switchThumb, checked && styles.switchThumbOn]} /></Pressable></View><View style={styles.thresholdSlider}><View style={[styles.thresholdRail, { backgroundColor: colors.border }]} /><View style={[styles.thresholdActiveRail, { width: `${ratio}%` }]} />{visibleOptions.map((option) => { const position = maximum === minimum ? 0 : ((option - minimum) / (maximum - minimum)) * 100; const selected = option === value; return <Pressable accessibilityLabel={`${option}% above normal`} accessibilityRole="adjustable" key={option} onPress={() => onValue(option)} style={[styles.thresholdStop, { left: `${position}%` }, selected && styles.thresholdStopSelected]}><View style={[styles.thresholdDot, selected && styles.thresholdDotSelected]} /><Text style={[styles.thresholdChoiceText, { color: selected ? '#58B6FF' : colors.textMuted }]}>{option}%</Text></Pressable>; })}</View><Text style={[styles.thresholdValue, { color: colors.text }]}>{value}% above normal</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{note}</Text></View>;
}

function NumberSetting({ colors, label, detail, prefix, value, max, onValue }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; detail: string; prefix?: string; value: number; max: number; onValue: (value: number) => void }) {
  return <View style={[styles.settingRow, { borderBottomColor: colors.border }]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><View style={[styles.numberBox, { backgroundColor: colors.input, borderColor: colors.border }]}>{prefix ? <Text style={{ color: colors.text }}>{prefix}</Text> : null}<TextInput keyboardType="number-pad" maxLength={3} onChangeText={(text) => onValue(Math.min(max, Math.max(0, Number(text) || 0)))} style={[styles.numberInput, { color: colors.text }]} value={String(value)} /></View></View>;
}

function HourInput({ colors, value, onValue }: { colors: ReturnType<typeof useAppTheme>['colors']; value: number; onValue: (value: number) => void }) {
  return <View style={[styles.hourBox, { backgroundColor: colors.input, borderColor: colors.border }]}><TextInput keyboardType="number-pad" maxLength={2} onChangeText={(text) => onValue(Math.min(23, Math.max(0, Number(text) || 0)))} style={[styles.hourInput, { color: colors.text }]} value={String(value)} /><Text style={{ color: colors.textMuted }}>:00</Text></View>;
}

function SettingLink({ colors, icon, label, detail, onPress }: { colors: ReturnType<typeof useAppTheme>['colors']; icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><View style={[styles.settingIcon, { backgroundColor: colors.input }]}><Ionicons color={colors.text} name={icon} size={20} /></View><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={20} /></Pressable>;
}

const styles = StyleSheet.create({
  settingsCard: { paddingVertical: 2 }, sectionDescription: { marginTop: -7, marginBottom: 10, fontSize: 11, lineHeight: 16 }, groupLabel: { paddingTop: 16, paddingBottom: 8, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }, settingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, paddingVertical: 12 }, settingIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, settingCopy: { flex: 1 }, settingTitle: { fontSize: 13, fontWeight: '900' }, settingDetail: { marginTop: 3, fontSize: 10, lineHeight: 14 }, checkbox: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 8 }, notificationNote: { paddingVertical: 12, fontSize: 10, lineHeight: 15 }, pressed: { opacity: 0.68 },
  thresholdBlock: { gap: 8, borderBottomWidth: 1, paddingVertical: 15 }, disabledChannel: { opacity: 0.48 }, thresholdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switchTrack: { width: 44, height: 26, justifyContent: 'center', borderRadius: 13, padding: 3 }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#777777' }, switchThumbOn: { alignSelf: 'flex-end', backgroundColor: '#FFFFFF' }, thresholdSlider: { height: 46, justifyContent: 'flex-start', marginHorizontal: 10, marginTop: 4 }, thresholdRail: { position: 'absolute', top: 10, left: 0, right: 0, height: 5, borderRadius: 99 }, thresholdActiveRail: { position: 'absolute', top: 10, left: 0, height: 5, borderRadius: 99, backgroundColor: '#0A84FF' }, thresholdStop: { position: 'absolute', top: 0, width: 52, marginLeft: -26, alignItems: 'center' }, thresholdStopSelected: { transform: [{ scale: 1.06 }] }, thresholdDot: { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#8E8E93', backgroundColor: '#151515' }, thresholdDotSelected: { borderColor: '#58B6FF', backgroundColor: '#0A84FF' }, thresholdChoiceText: { marginTop: 7, fontSize: 10, fontWeight: '900' }, thresholdValue: { fontSize: 11, fontWeight: '900' }, numberBox: { minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 11, paddingHorizontal: 9 }, numberInput: { minWidth: 32, paddingVertical: 9, fontSize: 13, fontWeight: '800', textAlign: 'center' }, quietInputs: { alignItems: 'center', gap: 5 }, hourBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 7 }, hourInput: { width: 26, paddingVertical: 7, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  saveButton: { alignSelf: 'flex-end', width: 190, marginVertical: 14 }, connectedCard: { gap: 13 }, connectedTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 }, scanButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 16 }, scanButtonText: { color: '#000000', fontSize: 12, fontWeight: '900' }, scanResult: { fontSize: 11, lineHeight: 17 }, deviceRow: { borderTopWidth: 1, paddingTop: 10 }, footnote: { fontSize: 9, lineHeight: 14 },
  dataMode: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 14 }, dataIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E7F8F1' }, dataCopy: { flex: 1 }, dataTitle: { fontSize: 12, fontWeight: '900' }, dataBody: { marginTop: 3, fontSize: 10, lineHeight: 14 }, activeBadge: { borderRadius: 8, backgroundColor: '#E7F8F1', paddingHorizontal: 7, paddingVertical: 4 }, activeText: { color: palette.green, fontSize: 8, fontWeight: '900' },
  modalText: { fontSize: 13, lineHeight: 21 }, modalHeading: { marginTop: 20, marginBottom: 10, fontSize: 16, fontWeight: '900' }, bullet: { flexDirection: 'row', gap: 8, marginVertical: 7 }, bulletText: { flex: 1, fontSize: 12, lineHeight: 18 },
  securityHero: { alignItems: 'center', paddingVertical: 10 }, securityIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#0D0D0D' }, securityTitle: { marginTop: 15, fontSize: 17, fontWeight: '900' }, securityIntro: { marginTop: 6, fontSize: 12, lineHeight: 18, textAlign: 'center' }, securityActions: { marginTop: 10 }, securityNote: { marginTop: 14, fontSize: 10, lineHeight: 16 },
  form: { gap: 16 }, formIntro: { fontSize: 12, lineHeight: 18 }, resetIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 18, backgroundColor: '#0D0D0D' }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
});
