import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/providers/auth';
import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';
import { useHouseholdResource, type ClashProgress } from '@/lib/experience-api';
import { tactile } from '@/lib/haptics';
import { clashDay, plannedQuest, planningAcknowledgement } from '@/lib/clash-quest';
import { EnergyToken } from '@/features/clash/components/EnergyToken';
import { ClashHue, useClashColors } from '@/features/clash/components/ClashHue';
import { GameTransition } from '@/features/clash/components/GameTransition';
import { PrimaryButton } from './ui';
import { SparkyPresence } from './sparky-presence';

export function ClashCoach({ motion = true }: { motion?: boolean }) {
  const colors = useClashColors();
  const { session } = useAuth();
  const { data, error, refresh } = useHouseholdResource<ClashProgress>('clash');
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ account: string; id: string; day: string; message: string; recorded: boolean } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const inFlight = useRef(false);
  const missionIndex = Math.max(0, data?.missions.findIndex((item) => item.id === missionId) ?? 0);
  const mission = data?.missions[missionIndex];
  const missionTint = mission?.id === 'review_energy_plan' ? colors.icons.money : mission?.id === 'ev_off_peak' ? colors.icons.info : colors.icons.warm;
  const today = clashDay();
  const confirmed = confirmation && confirmation.account === session?.customerId && confirmation.day === today ? confirmation : null;
  const alreadyPlanned = Boolean(mission && (plannedQuest(data?.events ?? [], mission.id, today) || confirmed?.recorded && confirmed.id === mission.id));
  const choose = (index: number) => {
    if (!data?.missions[index]) return;
    setMissionId(data.missions[index].id);
    setSaveError(null);
    tactile();
  };
  async function plan(id: string) {
    if (!session || inFlight.current || alreadyPlanned) return;
    inFlight.current = true;
    setSaving(id); setSaveError(null);
    try {
      const response = await apiJson<ClashProgress>(apiPath('/api/households/{customer_id}/clash/plans', { customer_id: session.customerId }), jsonRequest('POST', { mission_id: id }));
      const acknowledgedDay = clashDay();
      setConfirmation({ account: session.customerId, id, day: acknowledgedDay, message: planningAcknowledgement(response.events, id, acknowledgedDay), recorded: plannedQuest(response.events, id, acknowledgedDay) });
      tactile();
      refresh();
    } catch (failure: unknown) { setSaveError(failure instanceof Error ? failure.message : 'Plan could not be saved.'); tactile('error'); }
    finally { inFlight.current = false; setSaving(null); }
  }
  return <View style={styles.content}>
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <ClashHue color={colors.icons.energy} />
      <View style={styles.progressRow}>
        <View style={styles.progressCopy}>
          <Text style={[styles.eyebrow, { color: colors.text }]}>YOUR ENERGY JOURNEY</Text>
          <Text style={[styles.xp, { color: colors.text }]}>{data ? `${data.total_xp} XP` : 'Start with one good move'}</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>{data ? `${data.planning_xp} planning · ${data.verified_xp} device verified` : error ?? 'Checking your progress…'}</Text>
        </View>
        <EnergyToken />
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>XP has no cash value. A saved plan is not proof of energy or money saved.</Text>
      {data ? <>
        <View style={[styles.verified, { backgroundColor: colors.surfaceRaised }]}>
          <Ionicons color={colors.icons.money} name="shield-checkmark-outline" size={20} />
          <Text style={[styles.body, styles.verifiedCopy, { color: colors.textMuted }]}>Verified shifts · <Text style={{ color: colors.text, fontWeight: '700' }}>${Number(data.estimated_shift_savings_nzd).toFixed(2)}</Text> estimated tariff saving</Text>
        </View>
        {data.storage === 'memory' ? <Text style={[styles.caption, { color: colors.textMuted }]}>Development progress resets when the server restarts.</Text> : null}
      </> : error ? <PrimaryButton label="Retry progress" onPress={refresh} variant="secondary" /> : null}
    </View>

    {mission && data ? <View style={[styles.quest, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <ClashHue color={missionTint} />
      <View style={styles.questHeading}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose your next quest</Text>
        <Text style={[styles.caption, { color: colors.textMuted }]}>{missionIndex + 1} / {data.missions.length}</Text>
      </View>
      <View style={styles.questSelector}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous quest" disabled={missionIndex === 0} onPress={() => choose(missionIndex - 1)} style={[styles.arrow, { backgroundColor: colors.surfaceRaised }, missionIndex === 0 && styles.disabled]}><Ionicons name="chevron-back" color={colors.text} size={20} /></Pressable>
        <View style={styles.dots}>{data.missions.map((item, index) => <Pressable key={item.id} accessibilityLabel={`Quest ${index + 1}: ${item.title}`} accessibilityRole="button" accessibilityState={{ selected: index === missionIndex }} onPress={() => choose(index)} style={styles.dotTarget}><View style={[styles.dot, { backgroundColor: index === missionIndex ? colors.icons.energy : colors.border }, index === missionIndex && styles.activeDot]} /></Pressable>)}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Next quest" disabled={missionIndex === data.missions.length - 1} onPress={() => choose(missionIndex + 1)} style={[styles.arrow, { backgroundColor: colors.surfaceRaised }, missionIndex === data.missions.length - 1 && styles.disabled]}><Ionicons name="chevron-forward" color={colors.text} size={20} /></Pressable>
      </View>
      <GameTransition key={mission.id} motion={motion}>
        <View style={styles.missionTitle}>
          <View style={[styles.missionIcon, { backgroundColor: colors.surfaceRaised }]}><Ionicons name={mission.id === 'ev_off_peak' ? 'car-sport' : mission.id === 'review_energy_plan' ? 'cash' : 'time'} size={26} color={missionTint} /></View>
          <Text style={[styles.missionName, { color: colors.text }]}>{mission.title}</Text>
        </View>
        <View style={styles.sparkyTip}><SparkyPresence auroraTint size={64} /><Text style={[styles.body, styles.tipCopy, { color: colors.textMuted }]}>Let’s find a move that fits your day. Your comfort, essential needs and EV departure time come first.</Text></View>
        <Text style={[styles.caption, { color: colors.text }]}>+{mission.planning_xp} planning XP · once per Auckland day</Text>
        <PrimaryButton label="Plan with Sparky" leading={<SparkyPresence size={25} />} onPress={() => router.push({ pathname: '/assistant', params: { question: mission.question } })} />
        <PrimaryButton label={alreadyPlanned ? 'In your plan for today' : 'Add to my daily plan'} disabled={Boolean(saving) || alreadyPlanned} loading={saving === mission.id} onPress={() => { void plan(mission.id); }} variant="secondary" />
        {confirmed?.id === mission.id ? <Text accessibilityLiveRegion="polite" style={[styles.success, { color: colors.text }]}>{confirmed.message}</Text> : null}
        {saveError ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.icons.alert }]}>{saveError}</Text> : null}
      </GameTransition>
    </View> : null}

    {data?.events.length ? <View style={[styles.history, { backgroundColor: colors.surface }]}>
      <ClashHue color={colors.icons.info} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showHistory }} onPress={() => { setShowHistory((current) => !current); tactile(); }} style={styles.historyHeader}>
        <Ionicons name="time-outline" size={21} color={colors.icons.info} /><Text style={[styles.historyTitle, { color: colors.text }]}>Your recent actions</Text><Ionicons name={showHistory ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {showHistory ? <GameTransition motion={motion}>{data.events.slice(0, 5).map((event) => <View key={event.key} style={[styles.historyRow, { borderTopColor: colors.border }]}><Text style={[styles.body, { color: colors.text, fontWeight: '700' }]}>+{event.xp} XP · {event.mission_id.replaceAll('_', ' ')}</Text><Text style={[styles.caption, { color: colors.textMuted }]}>{event.day} · {event.evidence} · {event.source}</Text></View>)}</GameTransition> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 15 }, hero: { borderWidth: 1, borderRadius: 24, overflow: 'hidden', padding: 18, gap: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, progressCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }, xp: { fontSize: 30, fontWeight: '800', marginTop: 8 },
  body: { fontSize: 14, lineHeight: 21 }, caption: { fontSize: 12, lineHeight: 18 }, verified: { borderRadius: 14, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'center' }, verifiedCopy: { flex: 1 },
  quest: { borderWidth: 1, borderRadius: 24, overflow: 'hidden', padding: 18, gap: 15 }, questHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  sectionTitle: { fontSize: 19, fontWeight: '800', flex: 1 }, questSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minHeight: 44, minWidth: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, dots: { flexDirection: 'row' }, dotTarget: { minWidth: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 7 }, activeDot: { width: 20 }, disabled: { opacity: 0.35 },
  missionTitle: { flexDirection: 'row', gap: 12, alignItems: 'center' }, missionIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, missionName: { flex: 1, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  sparkyTip: { flexDirection: 'row', alignItems: 'center', gap: 12 }, tipCopy: { flex: 1 }, success: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  history: { borderRadius: 22, overflow: 'hidden', padding: 16, gap: 10 }, historyHeader: { minHeight: 44, flexDirection: 'row', gap: 10, alignItems: 'center' }, historyTitle: { flex: 1, fontSize: 15, fontWeight: '700' }, historyRow: { borderTopWidth: 1, paddingTop: 12, gap: 4 },
});
