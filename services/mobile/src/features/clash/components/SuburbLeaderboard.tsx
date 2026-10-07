import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { demoLeaderboard, type DemoDistrictId } from '@/lib/clash-preview';
import { ClashHue, useClashColors } from './ClashHue';

export function SuburbLeaderboard({ districtId, districtName }: { districtId: DemoDistrictId; districtName: string }) {
  const colors = useClashColors();
  const standings = demoLeaderboard(districtId);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <ClashHue color={colors.icons.money} />
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.text }]}>Monthly leaderboard</Text>
        <View style={[styles.badge, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.badgeText, { color: colors.textMuted }]}>DEMO</Text></View>
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>People within {districtName} compete each month. These names and scores are synthetic.</Text>
      {standings.map((player) => {
        const isYou = player.id === 'you';
        const topThree = player.rank <= 3;
        return (
          <View accessibilityLabel={`Rank ${player.rank}, ${player.label}, ${player.score.toFixed(1)} sample points`} key={player.id} style={[styles.row, { backgroundColor: isYou ? colors.surfaceRaised : colors.surface, borderColor: isYou ? colors.icons.energy : colors.border }]}>
            {isYou ? <ClashHue color={colors.icons.energy} /> : null}
            <View style={[styles.rankBadge, { backgroundColor: colors.surfaceRaised }]}>
              {topThree ? <Ionicons color={colors.icons.money} name="trophy-outline" size={14} /> : null}
              <Text style={[styles.rank, { color: topThree ? colors.text : colors.textMuted }]}>{player.rank}</Text>
            </View>
            <View style={styles.nameWrap}>
              <Text style={[styles.name, { color: colors.text }]}>{player.label}</Text>
              {isYou ? <Text style={[styles.you, { color: colors.textMuted }]}>SAMPLE PROFILE</Text> : null}
            </View>
            <Text style={[styles.points, { color: colors.text }]}>{player.score.toFixed(1)} <Text style={[styles.pointUnit, { color: colors.textMuted }]}>pts</Text></Text>
          </View>
        );
      })}
      <Text style={[styles.footer, { color: colors.textMuted }]}>Final rankings and bill credits would be settled after month-end data checks. No credits are active in this preview.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden', padding: 18, gap: 9 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '800' },
  badge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  caption: { fontSize: 11, lineHeight: 16, marginBottom: 4 },
  row: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58 },
  rankBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2 },
  rank: { fontSize: 12, fontWeight: '800' },
  nameWrap: { flex: 1 },
  name: { fontSize: 13, fontWeight: '800' },
  you: { marginTop: 2, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  points: { fontSize: 14, fontWeight: '800' },
  pointUnit: { fontSize: 10, fontWeight: '500' },
  footer: { fontSize: 10, lineHeight: 15, marginTop: 4 },
});
