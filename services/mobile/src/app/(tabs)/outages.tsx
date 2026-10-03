import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { SparkyPresence } from '@/components/sparky-presence';
import { useHouseholdResource, type OutageView } from '@/lib/experience-api';
import { useAppTheme } from '@/theme';

export default function OutagesScreen() {
  const { colors } = useAppTheme();
  const { data, error, refresh } = useHouseholdResource<OutageView>('scheduled-outages');
  const status = error ? 'Schedule unavailable' : !data ? 'Checking your schedule…' : data.status === 'not_linked' ? 'Link your distributor' : data.status === 'stale' ? 'Please confirm this schedule' : 'Your linked schedule';
  const note = error ?? (data?.status === 'not_linked' ? 'Find your lines company using your supply address. A linked notice is needed before Kea can confirm planned work.' : 'Planned work can move or be cancelled. Confirm the latest distributor notice before making arrangements.');
  return <Screen><PageHeader title="Scheduled outages" subtitle="A little preparation. More peace of mind." />
    <Card><View style={styles.row}><View style={[styles.icon, { backgroundColor: colors.icons.info + '18' }]}><Ionicons name="calendar-outline" color={colors.icons.info} size={24} /></View><View style={styles.copy}><Text style={[styles.title, { color: colors.text }]}>{status}</Text><Text style={[styles.body, { color: colors.textMuted }]}>{note}</Text></View></View><View style={styles.action}><PrimaryButton label="Refresh schedule" icon="refresh-outline" onPress={refresh} variant="secondary" /></View></Card>
    {data?.snapshot ? <><SectionTitle>{data.snapshot.distributor}</SectionTitle><Text style={[styles.caption, { color: colors.textMuted }]}>Checked {new Date(data.snapshot.fetched_at).toLocaleString('en-NZ')} · revision {data.snapshot.revision}</Text>
      <View style={styles.events}>{data.snapshot.events.length === 0 ? <Card><Text style={[styles.body, { color: colors.text }]}>No planned work is listed in this snapshot. Unexpected outages can still occur.</Text></Card> : data.snapshot.events.map(event => <Card key={event.event_id}><View style={styles.row}><View style={[styles.icon, { backgroundColor: colors.icons.alert + '18' }]}><Ionicons name={event.status === 'cancelled' ? 'close-circle-outline' : 'flash-outline'} color={event.status === 'cancelled' ? colors.icons.utility : colors.icons.alert} size={22} /></View><View style={styles.copy}><Text style={[styles.caption, { color: colors.icons.alert }]}>{event.status.toUpperCase()}</Text><Text style={[styles.title, { color: colors.text }]}>{event.title}</Text></View></View><View style={[styles.timing, { borderColor: colors.border }]}>{[['STARTS', event.start], ['ENDS', event.end]].map(([label, at]) => <View key={label} style={styles.timeRow}><Text style={[styles.caption, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.time, { color: colors.text }]}>{new Date(at!).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text></View>)}</View><Text style={[styles.body, { color: colors.textMuted }]}>{event.reason}</Text></Card>)}</View><PrimaryButton label="Open distributor notice" icon="open-outline" onPress={() => { void Linking.openURL(data.snapshot!.source_url); }} variant="secondary" />
    </> : <View style={styles.action}><PrimaryButton label="Find my lines company" icon="open-outline" onPress={() => { void Linking.openURL('https://www.ena.org.nz/your-lines-company/lines-company-map'); }} variant="secondary" /></View>}
    <SectionTitle>Make a simple plan</SectionTitle><Card><View style={styles.preparation}>{([
      ['battery-charging-outline', 'Charge what matters', 'Keep essential devices and a torch ready.'],
      ['shield-checkmark-outline', 'Keep essential loads safe', 'Check your backup plan. Never shift an essential load for points.'],
      ['heart-outline', 'Follow your care plan', 'For medical equipment, follow your agreed emergency plan. In a medical emergency, call 111.'],
    ] as const).map(([icon, title, body]) => <View key={title} style={styles.row}><View style={[styles.icon, { backgroundColor: colors.icons.energy + '18' }]}><Ionicons name={icon} color={colors.icons.energy} size={21} /></View><View style={styles.copy}><Text style={[styles.title, { color: colors.text }]}>{title}</Text><Text style={[styles.body, { color: colors.textMuted }]}>{body}</Text></View></View>)}</View><PrimaryButton label="Prepare with Sparky" leading={<SparkyPresence size={26} />} onPress={() => router.push({ pathname: '/assistant', params: { question: 'Help me prepare safely for a scheduled power outage. Use my linked notice if available and explain anything you cannot confirm.' } })} /></Card>
  </Screen>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 }, title: { fontSize: 15, lineHeight: 21, fontWeight: '800' }, body: { fontSize: 13, lineHeight: 20, marginTop: 5 }, caption: { fontSize: 10, lineHeight: 16, fontWeight: '700' }, action: { marginTop: 16 }, events: { gap: 12, marginVertical: 14 }, timing: { borderTopWidth: 1, marginTop: 14, paddingTop: 10, gap: 8 }, timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, time: { fontSize: 13, fontWeight: '700', flexShrink: 1 }, preparation: { gap: 18, marginBottom: 20 },
});
