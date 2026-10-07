import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { FormField, IconButton, PageHeader, PrimaryButton } from '@/components/ui';
import { emptyCustomerProfile, loadCustomerProfile, updateCustomerProfile, type CustomerProfile } from '@/lib/profile-data';
import { validateEmail, validatePhone, validateRequired } from '@/lib/validation';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

type Errors = Partial<Record<'name' | 'address' | 'phone' | 'email', string>>;

// The backend has no avatar field. Match the illustrative photo used by the
// website's profile menu and page; it is not asserted to be the account holder.
const customerPortrait = require('../../../assets/kea/customer-profile-man.png');

export default function ProfileScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { showToast } = useToast();
  const { session, signOut } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile>(() => emptyCustomerProfile(session?.customerId, session?.displayName, session?.email));
  const [draft, setDraft] = useState<CustomerProfile>(profile);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [message, setMessage] = useState('Loading profile…');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const details = [
    ['person', 'Customer ID', profile.customerId, 'info'],
    ['person-circle', 'Name', profile.name, 'info'],
    ['location', 'Address', profile.address, 'warm'],
    ['call', 'Contact', profile.phone, 'success'],
    ['mail', 'Email', profile.email, 'info'],
    ['card', 'Account number', profile.accountNumber, 'money'],
    ['flash', 'Plan', profile.planName, 'energy'],
    ['business', 'Network', profile.networkName, 'utility'],
    ['barcode', 'ICP number', profile.icpNumber, 'utility'],
  ] as const;

  useEffect(() => {
    const controller = new AbortController();
    void loadCustomerProfile(session?.customerId ?? '', session?.displayName ?? '', session?.email ?? '', controller.signal)
      .then(async (result) => {
        const loaded = result.data;
        if (controller.signal.aborted) return;
        setProfile(loaded);
        setDraft(loaded);
        setStatus(result.state);
        setMessage(result.state === 'unavailable' ? 'Account details could not be loaded. Retry before editing.' : '');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Profile details could not be loaded.');
      });
    return () => controller.abort();
  }, [session?.customerId, session?.displayName, session?.email]);

  const closeEditor = () => {
    Keyboard.dismiss();
    setEditing(false);
  };

  const save = async () => {
    const next: Errors = { name: validateRequired(draft.name, 'Full name'), phone: draft.phone ? validatePhone(draft.phone) : undefined, email: validateEmail(draft.email) };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const updated = await updateCustomerProfile(draft, new AbortController().signal);
      setProfile(updated);
      setDraft(updated);
      setEditing(false);
      showToast('Your contact details were saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Profile could not be saved.', 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen hue hueStart={2} hueStretch>
      <PageHeader action={<IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />} title="Profile" subtitle="Your account and contact details" />
      <View style={styles.profileContent}>
        <View style={[styles.hero, { borderBottomColor: colors.border }]}><View><Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>KEA CUSTOMER</Text><Text style={[styles.heroName, { color: colors.text }]}>{profile.name}</Text></View><Image accessibilityLabel="Illustrative customer portrait" contentFit="cover" source={customerPortrait} style={styles.portrait} /></View>
        <View style={styles.details}>{details.map(([icon, label, value, tint]) => <View key={label} style={[styles.detail, { borderBottomColor: colors.border }]}><Ionicons color={colors.icons[tint]} name={icon} size={22} /><View style={styles.detailCopy}><Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.detailValue, { color: colors.text }]}>{value || 'Not available'}</Text></View></View>)}</View>
        {message ? <Text accessibilityRole={status === 'error' ? 'alert' : 'text'} style={[styles.dataMessage, { color: status === 'error' ? palette.red : colors.textMuted }]}>{message}</Text> : null}
        <PrimaryButton disabled={status === 'loading'} icon="create-outline" label={status === 'loading' ? 'Loading…' : 'Edit on this phone'} onPress={() => { setDraft(profile); setErrors({}); setEditing(true); }} />
        <View style={styles.signOut}><PrimaryButton icon="log-out-outline" label="Sign out" onPress={() => setLogoutOpen(true)} variant="danger" /></View>
      </View>
      <View style={[styles.security, { borderTopColor: colors.border }]}><Ionicons color={colors.icons.success} name="shield-checkmark" size={26} /><View style={styles.securityCopy}><Text style={[styles.securityTitle, { color: colors.text }]}>Local profile copy</Text><Text style={[styles.securityBody, { color: colors.textMuted }]}>Edits stay on this phone. Your Kea account, sign-in and billing details are unchanged. Contact Customer Care to update your account.</Text></View></View>
      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton disabled={saving} label="Cancel" onPress={closeEditor} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton loading={saving} label="Save on phone" onPress={() => void save()} /></View></View>} keyboardAware onClose={closeEditor} title="Edit local profile" visible={editing}>
        <View style={styles.form}><FormField autoCapitalize="words" error={errors.name} label="Full name" onChangeText={(name) => { setDraft({ ...draft, name }); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="Full name" value={draft.name} /><FormField error={errors.phone} keyboardType="phone-pad" label="Contact number" onChangeText={(phone) => { setDraft({ ...draft, phone }); setErrors((current) => ({ ...current, phone: undefined })); }} placeholder="Contact number" value={draft.phone} /><FormField error={errors.email} keyboardType="email-address" label="Email" onChangeText={(email) => { setDraft({ ...draft, email }); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="name@example.com" value={draft.email} /></View>
      </ModalSheet>
      <ModalSheet footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setLogoutOpen(false)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Sign out" onPress={() => { void signOut().then(() => { setLogoutOpen(false); router.replace('/login'); }); }} variant="danger" /></View></View>} onClose={() => setLogoutOpen(false)} title="Sign out?" visible={logoutOpen}><Text style={[styles.logoutMessage, { color: colors.textMuted }]}>Are you sure you want to sign out of your Kea Energy account?</Text></ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileContent: { overflow: 'hidden' }, hero: { minHeight: 145, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, paddingLeft: 20 }, heroEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 }, heroName: { maxWidth: 200, marginTop: 7, fontSize: 24, fontWeight: '900' }, portrait: { width: 112, height: 112, borderRadius: 56, marginRight: 18 }, details: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 }, detail: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1 }, detailCopy: { flex: 1 }, detailLabel: { fontSize: 12, fontWeight: '700' }, detailValue: { marginTop: 3, fontSize: 14, fontWeight: '800' }, dataMessage: { paddingHorizontal: 18, paddingBottom: 14, fontSize: 12, lineHeight: 17 }, signOut: { marginTop: 18 }, logoutMessage: { fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 12 }, security: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, borderTopWidth: 1, paddingTop: 16, paddingHorizontal: 2 }, securityCopy: { flex: 1 }, securityTitle: { fontSize: 14, fontWeight: '900' }, securityBody: { marginTop: 3, fontSize: 12, lineHeight: 17 }, form: { gap: 16 }, footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 },
});
