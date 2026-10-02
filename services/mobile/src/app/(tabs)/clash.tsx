import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ClashCoach } from '@/components/clash-coach';
import { tactile } from '@/lib/haptics';
import { Screen } from '@/components/screen';
import { PageHeader } from '@/components/ui';
import { EnergyArena } from '@/features/clash/components/EnergyArena';
import { MonthlyRewardCard } from '@/features/clash/components/MonthlyRewardCard';
import { NextMoveCard } from '@/features/clash/components/NextMoveCard';
import { ScoreBreakdown } from '@/features/clash/components/ScoreBreakdown';
import { SparkyCompanionWidget } from '@/features/clash/components/SparkyCompanionWidget';
import { SuburbLeaderboard } from '@/features/clash/components/SuburbLeaderboard';
import { SuburbLeagueHeader } from '@/features/clash/components/SuburbLeagueHeader';
import { demoDistricts, demoLeaderboard, locationOutcomeCopy, nearbyDemoDistrict, type DemoDistrictId, type LocationOutcome, type MetricKey } from '@/lib/clash-preview';
import { useAppTheme } from '@/theme';

function selectionFeedback() {
  tactile();
}

export default function ClashScreen() {
  const { colors } = useAppTheme();
  const [selectedId, setSelectedId] = useState<DemoDistrictId>('grey-lynn');
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('conservation');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationOutcome, setLocationOutcome] = useState<LocationOutcome | null>(null);
  const district = demoDistricts.find((item) => item.id === selectedId) ?? demoDistricts[0];
  const standings = demoLeaderboard(selectedId);
  const you = standings.find((item) => item.id === 'you') ?? standings[0];

  const selectDistrict = (id: DemoDistrictId) => {
    if (id === selectedId) return;
    setSelectedId(id);
    selectionFeedback();
  };
  const selectMetric = (key: MetricKey) => {
    if (key === selectedMetric) return;
    setSelectedMetric(key);
    selectionFeedback();
  };
  const suggestNearby = async () => {
    if (locationBusy) return;
    setLocationBusy(true);
    try {
      const current = await Location.getForegroundPermissionsAsync();
      const permission = current.granted || !current.canAskAgain ? current : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationOutcome('denied');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const suggestion = nearbyDemoDistrict(position.coords.latitude, position.coords.longitude);
      if (suggestion) {
        selectDistrict(suggestion.id);
        setLocationOutcome('nearby');
      } else {
        setLocationOutcome('outside');
      }
    } catch {
      setLocationOutcome('unavailable');
    } finally {
      setLocationBusy(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <PageHeader title="Power Clash" subtitle="Monthly suburb league · demo" />
      <SuburbLeagueHeader district={district.name} rank={you.rank} score={you.score} total={standings.length} />

      <View style={[styles.selectCard, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose a demo suburb</Text>
        <Text style={[styles.sectionBody, { color: colors.textMuted }]}>Your rank is against other sample players in this suburb. This does not enrol your account.</Text>
        <View style={styles.chips}>
          {demoDistricts.map((item) => {
            const selected = item.id === selectedId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={item.id}
                onPress={() => selectDistrict(item.id)}
                style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.input : colors.surfaceRaised, borderColor: selected ? colors.icons.energy : colors.border }, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, { color: selected ? colors.text : colors.textMuted }]}>{item.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.locationRow, { borderTopColor: colors.border }]}>
          <Ionicons color={colors.textMuted} name="location-outline" size={20} />
          <View style={styles.locationCopy}>
            <Text style={[styles.locationTitle, { color: colors.text }]}>Find a nearby example</Text>
            <Text style={[styles.locationBody, { color: colors.textMuted }]}>Optional, one-time approximate location. Coordinates stay in memory and are never saved or sent.</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Use location for a nearby demo suburb" accessibilityRole="button" disabled={locationBusy} onPress={() => void suggestNearby()} style={({ pressed }) => [styles.locationButton, { borderColor: colors.border }, pressed && styles.pressed, locationBusy && styles.disabled]}>
          {locationBusy ? <ActivityIndicator color={colors.text} size="small" /> : <Ionicons color={colors.text} name="navigate-outline" size={17} />}
          <Text style={[styles.locationButtonText, { color: colors.text }]}>{locationBusy ? 'Checking nearby suburbs…' : 'Use location once'}</Text>
        </Pressable>
        {locationOutcome ? <Text accessibilityLiveRegion="polite" style={[styles.locationResult, { color: colors.textMuted }]}>{locationOutcomeCopy(locationOutcome)} {locationOutcome === 'nearby' ? `Showing ${district.name} as an example.` : ''}</Text> : null}
      </View>

      <ClashCoach />
      <EnergyArena metrics={you.metrics} onSelect={selectMetric} selected={selectedMetric} />
      <ScoreBreakdown metrics={you.metrics} onSelect={selectMetric} selected={selectedMetric} />
      <SuburbLeaderboard districtId={selectedId} districtName={district.name} />
      <NextMoveCard />
      <MonthlyRewardCard />
      <SparkyCompanionWidget />
      <View style={[styles.boundaryCard, { backgroundColor: colors.surface }]}>
        <Ionicons color={colors.textMuted} name="shield-checkmark-outline" size={21} />
        <View style={styles.boundaryCopy}>
          <Text style={[styles.boundaryTitle, { color: colors.text }]}>What is needed for real rankings</Text>
          <Text style={[styles.boundaryBody, { color: colors.textMuted }]}>Verified meters, EV charger and solar evidence, actual tariffs, fair scoring, consent, and an approved bill-credit programme. No real score, carbon claim, rank, or credit is calculated here.</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 15, paddingBottom: 50 },
  selectCard: { borderRadius: 22, padding: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  sectionBody: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  chip: { minHeight: 38, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 11, fontWeight: '800' },
  locationRow: { borderTopWidth: 1, flexDirection: 'row', gap: 11, marginTop: 18, paddingTop: 17 },
  locationCopy: { flex: 1 },
  locationTitle: { fontSize: 12, fontWeight: '800' },
  locationBody: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  locationButton: { marginTop: 13, minHeight: 42, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  locationButtonText: { fontSize: 11, fontWeight: '800' },
  locationResult: { marginTop: 10, fontSize: 10, lineHeight: 15 },
  boundaryCard: { borderRadius: 22, padding: 17, flexDirection: 'row', gap: 12 },
  boundaryCopy: { flex: 1 },
  boundaryTitle: { fontSize: 13, fontWeight: '800' },
  boundaryBody: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.6 },
});
