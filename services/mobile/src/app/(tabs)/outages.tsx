import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Linking, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { useHouseholdResource, type OutageView } from '@/lib/experience-api';
import { useAppTheme } from '@/theme';

export default function OutagesScreen() {
  const { colors } = useAppTheme();
  const { data, error, refresh } = useHouseholdResource<OutageView>('scheduled-outages');
  return <Screen>
    <PageHeader title="Scheduled outages" subtitle="Plan ahead with your distributor" />
    <Card><View style={{ flexDirection: 'row', gap: 12 }}><Ionicons name="calendar" color={colors.icons.info} size={28} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{error ? 'Schedule unavailable' : !data ? 'Checking your schedule…' : data.status === 'not_linked' ? 'Your distributor schedule is not linked yet' : data.status === 'stale' ? 'This schedule may have changed' : 'Latest linked schedule'}</Text><Text style={{ color: colors.textMuted, marginTop: 6, lineHeight: 20 }}>{error ?? (data?.status === 'not_linked' ? 'Check your electricity distributor using your supply address. Kea cannot confirm there are no planned outages until a schedule is linked.' : 'Planned work can move or be cancelled. Confirm the latest notice before making arrangements.')}</Text></View></View>
      <PrimaryButton label="Refresh schedule" icon="refresh" onPress={refresh} variant="secondary" />
    </Card>
    {data?.snapshot ? <><SectionTitle>{data.snapshot.distributor}</SectionTitle><Text style={{ color: colors.textMuted, fontSize: 12 }}>Last checked {new Date(data.snapshot.fetched_at).toLocaleString('en-NZ')} · revision {data.snapshot.revision}</Text>
      {data.snapshot.events.length === 0 ? <Card><Text style={{ color: colors.text }}>No planned work is listed in this snapshot. Unexpected outages can still occur.</Text></Card> : data.snapshot.events.map((event) => <Card key={event.event_id}><View style={{ flexDirection: 'row', gap: 10 }}><Ionicons name={event.status === 'cancelled' ? 'close-circle' : 'flash'} color={event.status === 'cancelled' ? colors.icons.utility : colors.icons.alert} size={24} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: '700' }}>{event.title} · {event.status}</Text><Text style={{ color: colors.text, marginTop: 6 }}>{new Date(event.start).toLocaleString('en-NZ')} – {new Date(event.end).toLocaleString('en-NZ')}</Text><Text style={{ color: colors.textMuted, marginTop: 6 }}>{event.reason}</Text></View></View></Card>)}
      <PrimaryButton label="Open distributor source" icon="open-outline" onPress={() => { void Linking.openURL(data.snapshot!.source_url); }} variant="secondary" />
    </> : <PrimaryButton label="Find my electricity distributor" icon="open-outline" onPress={() => { void Linking.openURL('https://www.ena.org.nz/your-lines-company/lines-company-map'); }} variant="secondary" />}
    <SectionTitle>Prepare comfortably</SectionTitle>
    <Card><Text style={{ color: colors.text, lineHeight: 22 }}>Charge essential devices, keep a torch ready and check any backup power plan. Avoid rescheduling an essential load for points.</Text><Text style={{ color: colors.textMuted, lineHeight: 21, marginTop: 8 }}>If you depend on electricity for medical equipment, follow your agreed emergency plan. In a medical emergency, call 111.</Text><PrimaryButton label="Ask Sparky to help me prepare" onPress={() => router.push({ pathname: '/assistant', params: { question: 'Help me prepare safely for a scheduled power outage. Use my linked notice if available and explain anything you cannot confirm.' } })} /></Card>
  </Screen>;
}
