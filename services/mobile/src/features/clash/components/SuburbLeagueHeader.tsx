import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/theme';

export function SuburbLeagueHeader({ district, rank, total, score }: { district: string; rank: number; total: number; score: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.topLine}>
        <View style={[styles.demoBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Text style={[styles.demoBadgeText, { color: colors.text }]}>MONTHLY DEMO</Text>
        </View>
        <Ionicons color={colors.textMuted} name="trophy-outline" size={20} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Your suburb. Your progress.</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Compare a weighted energy score with other people in the same suburb.</Text>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.bottomLine}>
        <View style={styles.stat}>
          <Text style={[styles.meta, { color: colors.textMuted }]}>SAMPLE RANK IN {district.toUpperCase()}</Text>
          <Text style={[styles.value, { color: colors.text }]}>#{rank} <Text style={[styles.valueSuffix, { color: colors.textMuted }]}>of {total}</Text></Text>
        </View>
        <View style={[styles.score, { backgroundColor: colors.surfaceRaised }]}>
          <Text style={[styles.scoreValue, { color: colors.text }]}>{score.toFixed(1)}</Text>
          <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>demo pts</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 22, borderWidth: 1, padding: 20 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  demoBadge: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  demoBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { marginTop: 23, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { marginTop: 7, fontSize: 13, lineHeight: 19 },
  divider: { height: 1, marginTop: 22, marginBottom: 17 },
  bottomLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  stat: { flex: 1 },
  meta: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  value: { marginTop: 5, fontSize: 29, fontWeight: '800' },
  valueSuffix: { fontSize: 15, fontWeight: '600' },
  score: { minWidth: 79, borderRadius: 15, paddingVertical: 9, paddingHorizontal: 11, alignItems: 'center' },
  scoreValue: { fontSize: 18, fontWeight: '800' },
  scoreLabel: { fontSize: 10, marginTop: 2 },
});
