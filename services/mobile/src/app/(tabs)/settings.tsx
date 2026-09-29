import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, type LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { AppleSwitch } from '@/components/apple-switch';
import { Screen } from '@/components/screen';
import { Card, FormField, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { changeAccountPassword, requestPasswordReset } from '@/lib/account-api';
import { apiBase, apiJson, jsonRequest } from '@/lib/backend-client';
import { loadNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from '@/lib/settings-api';
import { validateEmail, validateNewPassword, validateRequired } from '@/lib/validation';
import { useToast } from '@/providers/toast';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme, type IconTint } from '@/theme';

type Preferences = NotificationPreferences;
type SettingsModal = 'privacy' | 'security' | 'change-password' | 'reset-email' | null;
type PasswordErrors = { current?: string; next?: string; confirm?: string };

const defaults: Preferences = { accountRef: '', enabled: true, emailNotifications: true, smsNotifications: false, phoneNotifications: false, billReminders: true, tier1Pct: 15, tier2Pct: 40, tier3Pct: 75, minOvershootNzd: 20, offlineModelOptIn: false, email: null, phoneE164: null, quietHoursStart: 21, quietHoursEnd: 8, timezone: 'Pacific/Auckland', theme: 'dark' };
const tierOptions = { email: [10, 15, 20, 30, 40], sms: [40, 50, 60, 70], phone: [70, 75, 80, 90, 100] } as const;
type ScanResult = { devices_found?: number; devices?: { name?: string; kind?: string; note?: string }[]; error?: string | null };

export default function SettingsScreen() {
  const { colors, mode, setMode } = useAppTheme();
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
      showToast(result.devices_found ? `Found ${result.devices_found} devices near the API server` : 'No devices answered near the API server', 'info');
    } catch (error) {
      setScan({ error: error instanceof Error ? error.message : 'The scan could not be started.' });
    } finally {
      setScanning(false);
    }
  };

  const alertsOff = !preferences.enabled;

  return (
    <Screen>
      <PageHeader title="Settings" subtitle="Manage your account preferences and privacy." />

      <SectionTitle>Appearance</SectionTitle>
      <Card style={styles.appearanceCard}>
        <View style={styles.appearanceRow}>
          <View style={[styles.appearanceIcon, { backgroundColor: colors.input, borderColor: colors.border }]}><Ionicons color={colors.text} name="color-palette-outline" size={21} /></View>
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.text }]}>Appearance</Text>
            <Text style={[styles.settingDetail, { color: colors.textMuted }]}>Choose how Kea looks on this device.</Text>
          </View>
        </View>
        <View style={[styles.appearanceControl, { backgroundColor: colors.input, borderColor: colors.border }]}>
          {(['light', 'dark'] as const).map((option) => {
            const active = mode === option;
            return <Pressable accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={`${option} theme`} key={option} onPress={() => setMode(option)} style={({ pressed }) => [styles.themeButton, active && { backgroundColor: colors.surfaceRaised, borderColor: colors.text }, pressed && styles.pressed]}>
              <Ionicons color={active ? colors.text : colors.textMuted} name={option === 'light' ? 'sunny-outline' : 'moon-outline'} size={20} />
              <Text style={[styles.themeButtonText, { color: active ? colors.text : colors.textMuted }]}>{option === 'light' ? 'Light' : 'Dark'}</Text>
            </Pressable>;
          })}
        </View>
      </Card>

      <SectionTitle>Bill-shock alerts</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>You choose how far over your bill has to be tracking before we get in touch, and how.</Text>
      <Card style={styles.settingsCard}>
        <NotificationChannel control="switch" checked={preferences.enabled} colors={colors} detail="Tell me when this cycle is heading somewhere I would not expect. The warning still shows in the app when this is off." icon="notifications" label="Bill-shock alerts" onPress={() => update({ enabled: !preferences.enabled })} tint="alert" />
        <Text style={[styles.groupLabel, { color: colors.textMuted }, alertsOff && styles.disabledChannel]}>HOW WE TELL YOU, AND HOW FAR OVER IS FAR ENOUGH</Text>
        <ThresholdChannel checked={preferences.emailNotifications} colors={colors} dimmed={alertsOff} label="Email" note="Always in writing, so you have a record." options={tierOptions.email} onToggle={() => update({ emailNotifications: !preferences.emailNotifications })} onValue={(tier1Pct) => update({ tier1Pct })} value={preferences.tier1Pct} />
        <ThresholdChannel checked={preferences.smsNotifications} colors={colors} dimmed={alertsOff} label="Text message" note="Interrupts your day — set this higher than the email." options={tierOptions.sms} onToggle={() => update({ smsNotifications: !preferences.smsNotifications })} onValue={(tier2Pct) => update({ tier2Pct })} value={preferences.tier2Pct} />
        <ThresholdChannel checked={preferences.phoneNotifications} colors={colors} dimmed={alertsOff} label="A call from Sparky" note="Sparky calls you. Off unless you turn it on." options={tierOptions.phone} onToggle={() => update({ phoneNotifications: !preferences.phoneNotifications })} onValue={(tier3Pct) => update({ tier3Pct })} value={preferences.tier3Pct} />
        <NumberSetting colors={colors} dimmed={alertsOff} detail="This is the dollar floor underneath every alert level above." label="Never alert me under" max={500} onValue={(minOvershootNzd) => update({ minOvershootNzd })} prefix="$" value={preferences.minOvershootNzd} />
        <View style={[styles.settingRow, { borderBottomColor: colors.border }, alertsOff && styles.disabledChannel]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>Quiet hours</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>Texts and calls wait until morning. Emails still arrive.</Text></View><View style={styles.quietInputs}><HourInput colors={colors} dimmed={alertsOff} onValue={(quietHoursStart) => update({ quietHoursStart })} value={preferences.quietHoursStart ?? 21} /><Text style={{ color: colors.textMuted }}>to</Text><HourInput colors={colors} dimmed={alertsOff} onValue={(quietHoursEnd) => update({ quietHoursEnd })} value={preferences.quietHoursEnd ?? 8} /></View></View>
        <NotificationChannel checked={preferences.offlineModelOptIn} colors={colors} detail={`Keep a small assistant on this device so Sparky can work without a connection.${offlineDownloadMb === null ? '' : ` About ${Math.round(offlineDownloadMb)} MB, downloaded over Wi-Fi only.`}`} icon="cloud-offline" label="Answers without a connection" onPress={() => update({ offlineModelOptIn: !preferences.offlineModelOptIn })} tint="ai" />
        <View style={styles.saveButton}><PrimaryButton label="Save alert settings" onPress={() => session?.customerId && void saveNotificationPreferences(session.customerId, preferences).then(() => showToast('Alert settings saved', 'success')).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Alert settings could not be saved.', 'warning'))} /></View>
        <NotificationChannel checked={preferences.billReminders} colors={colors} detail="Receive reminders before a bill is due." icon="calendar" label="Bill reminders" onPress={() => update({ billReminders: !preferences.billReminders })} tint="money" />
      </Card>

      <SectionTitle>Connected home</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Find devices near the API server. Discovery alone cannot measure their power use.</Text>
      <Card style={styles.connectedCard}>
        <View style={styles.connectedTitle}><Ionicons color={colors.text} name="radio-outline" size={22} /><Text style={[styles.modalHeading, { color: colors.text }]}>Smart devices near the API server</Text></View>
        <Text style={[styles.modalText, { color: colors.textMuted }]}>The scan runs where the Kea API is hosted ({apiBase()}), not on this phone. It can see device announcements only when that server shares your home network. Device power readings need a supported connection.</Text>
        <Pressable disabled={scanning} onPress={() => void scanNetwork()} style={styles.scanButton}>{scanning ? <ActivityIndicator color="#000000" /> : <Ionicons color="#000000" name="wifi-outline" size={18} />}<Text style={styles.scanButtonText}>{scanning ? 'Scanning…' : 'Scan server network'}</Text></Pressable>
        {scan?.error ? <Text style={[styles.scanResult, { color: palette.red }]}>The scan couldn’t run here — {scan.error}</Text> : null}
        {scan && !scan.error && !scan.devices_found ? <Text style={[styles.scanResult, { color: colors.textMuted }]}>Nothing answered on the server’s network. Your phone may be on a different network.</Text> : null}
        {scan?.devices?.map((device, index) => <View key={`${device.name}-${index}`} style={[styles.deviceRow, { borderTopColor: colors.border }]}><Text style={[styles.settingTitle, { color: colors.text }]}>{device.name ?? 'Smart device'}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{device.kind}{device.note ? ` · ${device.note}` : ''}</Text></View>)}
        {scan && !scan.error ? <PrimaryButton label="Ask Sparky about usage and devices" onPress={() => router.push({ pathname: '/assistant', params: { question: 'What does my energy breakdown show, and what did the network scan find? Please keep measured usage separate from device names.' } })} /> : null}
        <Text style={[styles.footnote, { color: colors.textMuted }]}>This scan stores nothing and does not read energy. Apple Home reading is not connected in this app yet.</Text>
      </Card>

      <SectionTitle>Account security</SectionTitle>
      <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Review your data and keep your account protected.</Text>
      <Card style={styles.settingsCard}>
        <SettingLink colors={colors} detail="Review how your account information is used." icon="shield-half" label="Privacy and data" onPress={() => setModal('privacy')} tint="success" />
        <SettingLink colors={colors} detail="Reset your password and protect your account." icon="lock-closed" label="Password and security" onPress={() => setModal('security')} tint="utility" />
      </Card>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setModal(null)} />} onClose={() => setModal(null)} title="Privacy and data" visible={modal === 'privacy'}>
        <Text style={[styles.modalText, { color: colors.textMuted }]}>Kea Energy uses account, contact, usage, billing and support information to provide and improve your energy service.</Text><Text style={[styles.modalHeading, { color: colors.text }]}>Your rights</Text>{['Request access to your personal information.', 'Ask for incorrect information to be corrected.', 'Understand how your information is used.', 'Request support from a person.'].map((item) => <View key={item} style={styles.bullet}><Ionicons color={palette.green} name="checkmark-circle" size={18} /><Text style={[styles.bulletText, { color: colors.textMuted }]}>{item}</Text></View>)}
      </ModalSheet>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setModal(null)} />} onClose={() => setModal(null)} title="Password and security" visible={modal === 'security'}>
        <View style={styles.securityHero}><View style={styles.securityIcon}><Ionicons color={palette.violet} name="lock-closed" size={29} /></View><Text style={[styles.securityTitle, { color: colors.text }]}>Protect your account</Text><Text style={[styles.securityIntro, { color: colors.textMuted }]}>Choose how you want to update or reset your password.</Text></View>
        <View style={styles.securityActions}>
          <SettingLink colors={colors} detail="Enter your current password and choose a new one" icon="key" label="Change password" onPress={() => setModal('change-password')} tint="utility" />
          <SettingLink colors={colors} detail="Enter an email address to request a secure reset link" icon="mail" label="Email reset link" onPress={() => { setResetEmailError(undefined); setModal('reset-email'); }} tint="info" />
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

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setModal(null)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton icon="mail" label="Send reset link" onPress={() => void sendReset()} /></View></View>} keyboardAware onClose={() => setModal(null)} title="Reset password by email" visible={modal === 'reset-email'}>
        <View style={styles.form}>
          <View style={styles.resetIcon}><Ionicons color={palette.violet} name="mail" size={27} /></View>
          <Text style={[styles.formIntro, { color: colors.textMuted }]}>Enter the account email that should receive password reset instructions.</Text>
          <FormField error={resetEmailError} keyboardType="email-address" label="Email address" onChangeText={(value) => { setResetEmail(value); setResetEmailError(undefined); }} placeholder="name@example.com" value={resetEmail} />
        </View>
      </ModalSheet>
    </Screen>
  );
}

function NotificationChannel({ colors, icon, label, detail, checked, onPress, control = 'checkbox', tint = 'utility' }: { colors: ReturnType<typeof useAppTheme>['colors']; icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; checked: boolean; onPress: () => void; control?: 'checkbox' | 'switch'; tint?: IconTint }) {
  return <Pressable accessibilityRole={control === 'switch' ? 'switch' : 'checkbox'} accessibilityState={{ checked }} onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><Ionicons color={colors.icons[tint]} name={icon} size={23} /><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View>{control === 'switch' ? <AppleSwitch checked={checked} label={label} onChange={onPress} /> : <View style={[styles.checkbox, { borderColor: checked ? palette.white : colors.border, backgroundColor: checked ? palette.white : 'transparent' }]}>{checked ? <Ionicons color="#000000" name="checkmark" size={17} /> : null}</View>}</Pressable>;
}

const SLIDER_ZONE = { green: '#57D98A', orange: '#F2C94C', red: '#EE6B60' };
const SLIDER_TRACK_BLUE = '#5B8DEF';

function SplitSlider({ colors, label, value, options, disabled, onValue }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; value: number; options: readonly number[]; disabled: boolean; onValue: (next: number) => void }) {
  const opts = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  const minimum = opts[0] ?? 0;
  const maximum = opts[opts.length - 1] ?? 100;
  const span = Math.max(maximum - minimum, 1);
  const valueToRatio = (v: number) => Math.min(1, Math.max(0, (v - minimum) / span));
  const ratioToValue = (r: number) => minimum + r * span;
  const nearestOption = (v: number) => opts.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), opts[0] ?? v);

  const position = useRef(new Animated.Value(valueToRatio(value))).current;
  const thumbScale = useRef(new Animated.Value(1)).current;
  const trackHeight = useRef(new Animated.Value(8)).current;
  const tickOpacity = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const ratioRef = useRef(valueToRatio(value));
  const grantRatioRef = useRef(0);
  const draggingRef = useRef(false);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (draggingRef.current) return;
    const target = valueToRatio(value);
    ratioRef.current = target;
    Animated.timing(position, { toValue: target, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  // `position` is a stable Animated.Value and `valueToRatio` is intentionally
  // derived from the current slider options for each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const endAt = (r: number) => {
    const snapped = nearestOption(ratioToValue(r));
    const target = valueToRatio(snapped);
    ratioRef.current = target;
    draggingRef.current = false;
    setDragValue(null);
    Animated.parallel([
      Animated.timing(position, { toValue: target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(thumbScale, { toValue: 1, duration: 160, useNativeDriver: false }),
      Animated.timing(trackHeight, { toValue: 8, duration: 220, useNativeDriver: false }),
      Animated.timing(tickOpacity, { toValue: 0, duration: 200, useNativeDriver: false }),
    ]).start();
    onValueRef.current(snapped);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        grantRatioRef.current = ratioRef.current;
        Animated.parallel([
          Animated.timing(thumbScale, { toValue: 1.25, duration: 120, useNativeDriver: false }),
          Animated.timing(trackHeight, { toValue: 14, duration: 150, useNativeDriver: false }),
          Animated.timing(tickOpacity, { toValue: 1, duration: 150, useNativeDriver: false }),
        ]).start();
      },
      onPanResponderMove: (_event, gesture) => {
        const w = trackWidthRef.current;
        if (w <= 0) return;
        const r = Math.min(1, Math.max(0, grantRatioRef.current + gesture.dx / w));
        ratioRef.current = r;
        position.setValue(r);
        setDragValue(nearestOption(ratioToValue(r)));
      },
      onPanResponderRelease: (event, gesture) => {
        const w = trackWidthRef.current;
        let r = ratioRef.current;
        if (w > 0 && Math.hypot(gesture.dx, gesture.dy) < 8) {
          r = Math.min(1, Math.max(0, (event.nativeEvent.pageX - trackPageXRef.current) / w));
        }
        endAt(r);
      },
      onPanResponderTerminate: () => {
        endAt(ratioRef.current);
      },
    }),
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackPageXRef.current = pageX;
    });
  };

  const step = (direction: 1 | -1) => {
    if (disabled) return;
    const index = opts.indexOf(nearestOption(value));
    const next = opts[Math.min(opts.length - 1, Math.max(0, index + direction))] ?? value;
    onValue(next);
  };

  const displayValue = dragValue ?? nearestOption(value);
  const inRedZone = valueToRatio(displayValue) >= 2 / 3;
  const fillWidth = position.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(trackWidth, 1)] });
  const zoneColor = position.interpolate({ inputRange: [0, 0.5, 1], outputRange: [SLIDER_ZONE.green, SLIDER_ZONE.orange, SLIDER_ZONE.red] });

  return (
    <View style={styles.sliderArea}>
      <View style={styles.sliderTopRow}>
        {inRedZone ? <Ionicons color={SLIDER_ZONE.red} name="warning" size={16} style={styles.sliderWarningIcon} /> : null}
        <Animated.Text style={[styles.sliderTopLabel, { color: zoneColor }]}>{displayValue}% above normal</Animated.Text>
      </View>
      <View
        ref={trackRef}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={`${label} threshold`}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: `${displayValue}% above normal` }}
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
        style={styles.sliderTouch}
      >
        <Animated.View style={[styles.sliderTrack, { height: trackHeight }]}>
          <View style={[styles.sliderBaseFill, { backgroundColor: SLIDER_TRACK_BLUE }]} />
          <Animated.View style={[styles.sliderFill, { width: fillWidth }]}>
            <Animated.View style={[styles.sliderBaseFill, { backgroundColor: zoneColor, width: Math.max(trackWidth, 1) }]} />
          </Animated.View>
          {opts.map((option) => (
            <Animated.View key={option} pointerEvents="none" style={[styles.sliderTick, { left: `${valueToRatio(option) * 100}%`, opacity: tickOpacity }]} />
          ))}
          <Animated.View style={[styles.sliderThumb, { left: fillWidth, transform: [{ translateX: -11 }, { scale: thumbScale }] }]} />
        </Animated.View>
      </View>
      <View pointerEvents="none" style={styles.sliderLabels}>
        {opts.map((option) => {
          const active = option === displayValue;
          return <Text key={option} style={[styles.sliderLabel, { left: `${valueToRatio(option) * 100}%`, color: active ? colors.text : colors.textMuted }]}>{option}%</Text>;
        })}
      </View>
    </View>
  );
}

function ThresholdChannel({ colors, label, note, checked, value, options, onToggle, onValue, dimmed = false }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; note: string; checked: boolean; value: number; options: readonly number[]; onToggle: () => void; onValue: (value: number) => void; dimmed?: boolean }) {
  const inactive = !checked || dimmed;
  // Master off => channel switches render off and can't be flipped. The real
  // preference values stay untouched so they restore when the master returns.
  const switchOn = checked && !dimmed;
  return <View style={[styles.thresholdBlock, { borderBottomColor: colors.border }, inactive && styles.disabledChannel]}><View style={styles.thresholdHeader}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><AppleSwitch checked={switchOn} disabled={dimmed} label={label} onChange={onToggle} /></View><SplitSlider colors={colors} disabled={inactive} label={label} onValue={onValue} options={options} value={value} /><Text style={[styles.thresholdValue, { color: colors.text }]}>{value}% above normal</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{note}</Text></View>;
}

function NumberSetting({ colors, label, detail, prefix, value, max, onValue, dimmed = false }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; detail: string; prefix?: string; value: number; max: number; onValue: (value: number) => void; dimmed?: boolean }) {
  return <View style={[styles.settingRow, { borderBottomColor: colors.border }, dimmed && styles.disabledChannel]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><View style={[styles.numberBox, { backgroundColor: colors.input, borderColor: colors.border }]}>{prefix ? <Text style={{ color: colors.text }}>{prefix}</Text> : null}<TextInput editable={!dimmed} keyboardType="number-pad" maxLength={3} onChangeText={(text) => onValue(Math.min(max, Math.max(0, Number(text) || 0)))} style={[styles.numberInput, { color: colors.text }]} value={String(value)} /></View></View>;
}

function HourInput({ colors, value, onValue, dimmed = false }: { colors: ReturnType<typeof useAppTheme>['colors']; value: number; onValue: (value: number) => void; dimmed?: boolean }) {
  return <View style={[styles.hourBox, { backgroundColor: colors.input, borderColor: colors.border }]}><TextInput editable={!dimmed} keyboardType="number-pad" maxLength={2} onChangeText={(text) => onValue(Math.min(23, Math.max(0, Number(text) || 0)))} style={[styles.hourInput, { color: colors.text }]} value={String(value)} /><Text style={{ color: colors.textMuted }}>:00</Text></View>;
}

function SettingLink({ colors, icon, label, detail, onPress, tint = 'utility' }: { colors: ReturnType<typeof useAppTheme>['colors']; icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void; tint?: IconTint }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}><Ionicons color={colors.icons[tint]} name={icon} size={23} /><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.settingDetail, { color: colors.textMuted }]}>{detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={20} /></Pressable>;
}

const styles = StyleSheet.create({
  screenEnter: { flex: 1 }, settingsCard: { paddingVertical: 2 }, appearanceCard: { gap: 16, paddingVertical: 16 }, appearanceRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, appearanceIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 }, appearanceControl: { width: '100%', flexDirection: 'row', gap: 6, borderWidth: 1, borderRadius: 14, padding: 4 }, themeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'transparent', borderRadius: 10 }, themeButtonText: { fontSize: 13, fontWeight: '800' }, sectionDescription: { marginTop: -7, marginBottom: 10, fontSize: 12, lineHeight: 17 }, groupLabel: { paddingTop: 16, paddingBottom: 8, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }, settingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, paddingVertical: 12 }, settingCopy: { flex: 1 }, settingTitle: { fontSize: 14, fontWeight: '900' }, settingDetail: { marginTop: 3, fontSize: 12, lineHeight: 17 }, checkbox: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 8 }, notificationNote: { paddingVertical: 12, fontSize: 12, lineHeight: 18 }, pressed: { opacity: 0.68 },
  thresholdBlock: { gap: 8, borderBottomWidth: 1, paddingVertical: 15 }, disabledChannel: { opacity: 0.48 }, thresholdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switchTrack: { width: 44, height: 26, justifyContent: 'center', borderRadius: 13, padding: 3 }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#777777' }, switchThumbOn: { alignSelf: 'flex-end', backgroundColor: '#FFFFFF' }, sliderArea: { marginTop: 8 }, sliderTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginHorizontal: 2 }, sliderWarningIcon: { marginRight: 6 }, sliderTopLabel: { fontSize: 14, fontWeight: '700' }, sliderTouch: { paddingVertical: 14, marginHorizontal: 2 }, sliderTrack: { position: 'relative' }, sliderBaseFill: { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, borderRadius: 99 }, sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, overflow: 'hidden' }, sliderThumb: { position: 'absolute', top: '50%', marginTop: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5 }, sliderTick: { position: 'absolute', top: '50%', marginTop: -4, width: 3, height: 8, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)', marginLeft: -1.5 }, sliderLabels: { position: 'relative', height: 20, marginTop: 6, marginHorizontal: 2 }, sliderLabel: { position: 'absolute', width: 48, marginLeft: -24, textAlign: 'center', fontSize: 12, fontWeight: '800' }, thresholdValue: { fontSize: 12, fontWeight: '900' }, numberBox: { minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 11, paddingHorizontal: 9 }, numberInput: { minWidth: 44, paddingVertical: 9, fontSize: 16, fontWeight: '800', textAlign: 'center' }, quietInputs: { alignItems: 'center', gap: 5 }, hourBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 7 }, hourInput: { width: 36, paddingVertical: 7, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  saveButton: { alignSelf: 'flex-end', width: 190, marginVertical: 14 }, connectedCard: { gap: 13 }, connectedTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 }, scanButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 16 }, scanButtonText: { color: '#000000', fontSize: 12, fontWeight: '900' }, scanResult: { fontSize: 12, lineHeight: 19 }, deviceRow: { borderTopWidth: 1, paddingTop: 10 }, footnote: { fontSize: 11, lineHeight: 17 },
  dataMode: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 14 }, dataIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E7F8F1' }, dataCopy: { flex: 1 }, dataTitle: { fontSize: 12, fontWeight: '900' }, dataBody: { marginTop: 3, fontSize: 12, lineHeight: 17 }, activeBadge: { borderRadius: 8, backgroundColor: '#E7F8F1', paddingHorizontal: 7, paddingVertical: 4 }, activeText: { color: palette.green, fontSize: 11, fontWeight: '900' },
  modalText: { fontSize: 14, lineHeight: 23 }, modalHeading: { marginTop: 20, marginBottom: 10, fontSize: 16, fontWeight: '900' }, bullet: { flexDirection: 'row', gap: 8, marginVertical: 7 }, bulletText: { flex: 1, fontSize: 12, lineHeight: 18 },
  securityHero: { alignItems: 'center', paddingVertical: 10 }, securityIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#0D0D0D' }, securityTitle: { marginTop: 15, fontSize: 17, fontWeight: '900' }, securityIntro: { marginTop: 6, fontSize: 12, lineHeight: 18, textAlign: 'center' }, securityActions: { marginTop: 10 }, securityNote: { marginTop: 14, fontSize: 12, lineHeight: 19 },
  form: { gap: 16 }, formIntro: { fontSize: 12, lineHeight: 18 }, resetIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 18, backgroundColor: '#0D0D0D' }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
});
