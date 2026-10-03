import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/theme';

export function MonthlyRewardCard() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceRaised }]}><Ionicons color={colors.icons.money} name="receipt-outline" size={23} /></View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: colors.textMuted }]}>PLANNED MONTHLY REWARD</Text>
        <Text style={[styles.title, { color: colors.text }]}>Bill credit for the top three</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>The highest eligible scores in each suburb would receive a credit on their electricity bill after the month closes.</Text>
        <View style={[styles.status, { backgroundColor: colors.surfaceRaised }]}>
          <Ionicons color={colors.textMuted} name="lock-closed-outline" size={14} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>Preview only · no credits awarded</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 17, flexDirection: 'row', gap: 13 },
  iconWrap: { width: 45, height: 45, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '800', marginTop: 5 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  status: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  statusText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
});
