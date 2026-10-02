import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/providers/auth';
import { useAppTheme } from '@/theme';
import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';
import { useHouseholdResource, type ClashProgress } from '@/lib/experience-api';
import { tactile } from '@/lib/haptics';
import { Card, PrimaryButton, SectionTitle } from './ui';
import { SparkyPresence } from './sparky-presence';

export function ClashCoach() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { data, error, refresh } = useHouseholdResource<ClashProgress>('clash');
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  async function plan(id: string) {
    if (!session || saving) return;
    setSaving(id); setSaveError(null);
    try {
      await apiJson(apiPath('/api/households/{customer_id}/clash/plans', { customer_id: session.customerId }), jsonRequest('POST', { mission_id: id }));
      tactile('success'); refresh();
    } catch (failure: unknown) { setSaveError(failure instanceof Error ? failure.message : 'Plan could not be saved.'); }
    finally { setSaving(null); }
  }
  return <View>
    <SectionTitle>Your progress with Sparky</SectionTitle>
    <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><SparkyPresence auroraTint size={80} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: '800', fontSize: 24 }}>{data ? `${data.total_xp} XP` : 'Your energy journey'}</Text><Text style={{ color: colors.textMuted, marginTop: 4 }}>{data ? `${data.planning_xp} planning · ${data.verified_xp} device verified` : error ?? 'Checking your progress…'}</Text></View></View>
      {data ? <><Text style={{ color: colors.textMuted, lineHeight: 20, marginTop: 8 }}>XP celebrates helpful actions. It has no cash value. Planning points do not prove that energy or money was saved.</Text><Text style={{ color: colors.icons.money, fontWeight: '700', marginTop: 8 }}>Estimated tariff saving from verified shifts: ${Number(data.estimated_shift_savings_nzd).toFixed(2)}</Text>{data.storage === 'memory' ? <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>Development progress resets when the server restarts.</Text> : null}</> : <PrimaryButton label="Retry progress" onPress={refresh} variant="secondary" />}
    </Card>
    {data?.missions.map((mission) => <Card key={mission.id}><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Ionicons name={mission.id === 'ev_off_peak' ? 'car-sport' : mission.id === 'review_energy_plan' ? 'cash' : 'time'} size={24} color={mission.id === 'review_energy_plan' ? colors.icons.money : colors.icons.energy} /><Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{mission.title}</Text></View><Text style={{ color: colors.textMuted, marginTop: 6 }}>Keep your comfort and essential needs first. +{mission.planning_xp} XP for planning once per day.</Text><PrimaryButton label="Plan with Sparky" onPress={() => router.push({ pathname: '/assistant', params: { question: mission.question } })} /><PrimaryButton label="Add to my daily plan" disabled={Boolean(saving)} loading={saving === mission.id} onPress={() => { void plan(mission.id); }} variant="secondary" /></Card>)}
    {saveError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.icons.alert }}>{saveError}</Text> : null}
    {data?.events.length ? <><SectionTitle>Recent actions</SectionTitle>{data.events.slice(0, 5).map((event) => <View key={event.key} style={{ paddingVertical: 9 }}><Text style={{ color: colors.text, fontWeight: '700' }}>+{event.xp} XP · {event.mission_id.replaceAll('_', ' ')}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>{event.day} · {event.evidence} · {event.source}</Text></View>)}</> : null}
  </View>;
}
