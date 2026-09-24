import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PricingStyle } from '@/lib/plans-data';
import { palette, useAppTheme } from '@/theme';

type PlanCardProps = { plan: PricingStyle; selected: boolean; current: boolean; onPress: () => void; onSelect: () => void };

export function PlanCard({ plan, selected, current, onPress, onSelect }: PlanCardProps) {
  const { colors } = useAppTheme();
  const icon = plan.id === 'time-of-use' ? 'time-outline' : plan.id === 'free-weekends' ? 'sunny-outline' : 'flash-outline';
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${plan.name}${selected ? ', selected' : ''}`} onPress={onPress} style={({ pressed }) => [styles.touchable, pressed && styles.pressed]}>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? palette.white : colors.border }, selected && styles.selectedCard]}>
      <View style={styles.cardTop}>
        <View style={[styles.planIcon, { backgroundColor: selected ? palette.white : colors.surfaceRaised }]}><Ionicons color={selected ? '#000000' : colors.text} name={icon} size={21} /></View>
        <View style={styles.badges}>{plan.badge ? <Text style={styles.recommendedBadge}>RECOMMENDED</Text> : null}{current ? <Text style={styles.currentBadge}>CURRENT</Text> : null}</View>
      </View>
      <Text style={[styles.eyebrow, { color: colors.textMuted }]}>{plan.eyebrow}</Text>
      <Text style={[styles.name, { color: colors.text }]}>{plan.name}</Text>
      <Text style={[styles.summary, { color: colors.textMuted }]}>{plan.summary ?? plan.eyebrow}</Text>
      <View style={[styles.ratePanel, { backgroundColor: colors.input }]}>
        {plan.rates.map((rate, index) => <View key={rate.label} style={[styles.rateRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }]}><View style={styles.rateCopy}><Text style={[styles.rateLabel, { color: colors.textMuted }]}>{rate.label}</Text>{rate.window ? <Text style={[styles.rateWindow, { color: colors.textMuted }]}>{rate.window}</Text> : null}</View><Text style={[styles.rate, { color: colors.text }]}>{rate.value}<Text style={styles.rateUnit}>{rate.unit}</Text></Text></View>)}
        <View style={[styles.rateRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}><Text style={[styles.rateLabel, { color: colors.textMuted }]}>Daily charge</Text><Text style={[styles.rate, { color: colors.text }]}>{plan.daily}<Text style={styles.rateUnit}>/day</Text></Text></View>
      </View>
      <View style={styles.highlights}>{plan.highlights.map((highlight) => <View key={highlight} style={styles.highlightRow}><View style={[styles.check, { backgroundColor: selected ? palette.white : colors.surfaceRaised }]}><Ionicons color={selected ? '#000000' : palette.green} name="checkmark" size={12} /></View><Text style={[styles.highlightText, { color: colors.text }]}>{highlight}</Text></View>)}</View>
      <View style={[styles.bestFor, { borderTopColor: colors.border }]}><Text style={[styles.bestForLabel, { color: colors.textMuted }]}>BEST FOR</Text><Text style={[styles.bestForText, { color: colors.text }]}>{plan.bestFor}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Select ${plan.name}`} onPress={onSelect} style={({ pressed }) => [styles.selectButton, { backgroundColor: selected ? palette.white : colors.surfaceRaised }, pressed && styles.buttonPressed]}><Ionicons color={selected ? '#000000' : colors.text} name={selected ? 'checkmark-circle' : 'checkmark-circle-outline'} size={17} /><Text style={[styles.selectLabel, { color: selected ? '#000000' : colors.text }]}>{selected ? 'Selected plan' : 'Select this plan'}</Text></Pressable>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  touchable: { width: '100%' }, pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] }, buttonPressed: { opacity: 0.82 }, card: { height: 700, borderWidth: 1, borderRadius: 28, padding: 20 }, selectedCard: { borderWidth: 1.5, shadowColor: '#D8D8D8', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 }, cardTop: { minHeight: 32, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, planIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, badges: { flex: 1, alignItems: 'flex-end', gap: 6 }, recommendedBadge: { overflow: 'hidden', color: '#FF9500', borderColor: '#FF9500', borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 8, fontWeight: '900', letterSpacing: 0.55 }, currentBadge: { overflow: 'hidden', color: palette.green, borderColor: palette.green, borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 8, fontWeight: '900', letterSpacing: 0.55 }, eyebrow: { marginTop: 20, fontSize: 11, fontWeight: '800', letterSpacing: 0.35, textTransform: 'uppercase' }, name: { marginTop: 5, fontSize: 25, lineHeight: 30, fontWeight: '900', letterSpacing: -0.7 }, summary: { minHeight: 54, marginTop: 8, fontSize: 12, lineHeight: 18, fontWeight: '600' }, ratePanel: { marginTop: 18, overflow: 'hidden', borderRadius: 17 }, rateRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }, rateCopy: { flex: 1 }, rateLabel: { fontSize: 13, lineHeight: 17, fontWeight: '800' }, rateWindow: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '700' }, rate: { fontSize: 17, fontWeight: '900', textAlign: 'right' }, rateUnit: { fontSize: 10, fontWeight: '800' }, highlights: { gap: 11, marginTop: 20 }, highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, check: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, highlightText: { flex: 1, fontSize: 11, lineHeight: 17, fontWeight: '700' }, bestFor: { marginTop: 17, borderTopWidth: 1, paddingTop: 14 }, bestForLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.6 }, bestForText: { marginTop: 4, fontSize: 11, lineHeight: 15, fontWeight: '800' }, selectButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 'auto', borderRadius: 14 }, selectLabel: { fontSize: 12, fontWeight: '900' },
});
