import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { loadPlans, requestPlanSwitch, type CommitmentTerm, type PricingStyle } from '@/lib/plans-data';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

export default function PlansScreen() {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const [pricingStyles, setPricingStyles] = useState<PricingStyle[]>([]);
  const [commitmentTerms, setCommitmentTerms] = useState<CommitmentTerm[]>([]);
  const [currentPlan, setCurrentPlan] = useState({ pricingStyle: '', term: '' });
  const [styleId, setStyleId] = useState('');
  const [termId, setTermId] = useState('');
  const [loadError, setLoadError] = useState<string>();
  const [compareOpen, setCompareOpen] = useState(false);
  const style = pricingStyles.find((item) => item.id === styleId) ?? pricingStyles[0];
  const term = commitmentTerms.find((item) => item.id === termId) ?? commitmentTerms[0];
  const isCurrent = styleId === currentPlan.pricingStyle && termId === currentPlan.term;

  useEffect(() => {
    const controller = new AbortController();
    void loadPlans(session?.customerId ?? '', controller.signal).then((data) => {
      setPricingStyles(data.pricingStyles);
      setCommitmentTerms(data.commitmentTerms);
      setCurrentPlan(data.currentPlan);
      setStyleId(data.currentPlan.pricingStyle);
      setTermId(data.currentPlan.term);
      setLoadError(undefined);
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      setLoadError(error instanceof Error ? error.message : 'Plans could not be loaded.');
    });
    return () => controller.abort();
  }, [session?.customerId]);

  const select = <T extends string>(value: T, setter: (value: T) => void) => {
    setter(value);
    void Haptics.selectionAsync();
  };

  const switchPlan = async () => {
    try {
      await requestPlanSwitch(session?.customerId ?? '', styleId, termId);
      showToast(`${style?.name} with the ${term?.name} term requested`);
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Plan switch could not be requested.', 'warning');
    }
  };

  if (!style || !term) return <Screen><PageHeader title="Plans" subtitle="Build a plan around how your household uses power" /><Text style={[styles.commitmentIntro, { color: loadError ? palette.red : colors.textMuted }]}>{loadError ?? 'Loading plans…'}</Text></Screen>;

  return (
    <Screen>
      <PageHeader
        action={(
          <Pressable
            accessibilityLabel="Ask Sparky to recommend a plan"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/assistant', params: { plan: `${style.name} (${term.name})` } })}
            style={({ pressed }) => [styles.sparkyAction, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Ionicons color={palette.violet} name="sparkles-outline" size={18} />
            <Text style={styles.sparkyActionText}>Ask Sparky to recommend a plan</Text>
          </Pressable>
        )}
        title="Plans"
        subtitle="Build a plan around how your household uses power"
      />
      <SectionTitle>1 · Choose your pricing</SectionTitle>
      <View style={styles.stack}>
        {pricingStyles.map((option) => {
          const selected = option.id === styleId;
          const current = option.id === currentPlan.pricingStyle;
          return (
            <Pressable key={option.id} onPress={() => select(option.id, setStyleId)} style={({ pressed }) => [pressed && styles.pressed]}>
              <Card style={[styles.option, current && styles.currentOption, selected && styles.selected]}>
                {current ? <Text style={styles.currentBadge}>CURRENT PLAN</Text> : option.badge ? <Text style={styles.badge}>{option.badge}</Text> : null}
                <View style={styles.optionHeader}>
                  <View style={[styles.radio, { borderColor: selected ? palette.violet : colors.border }]}>{selected ? <View style={styles.radioFill} /> : null}</View>
                  <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.text }]}>{option.name}</Text><Text style={styles.eyebrow}>{option.eyebrow}</Text></View>
                  <Text style={[styles.rate, { color: colors.text }]}>{option.rate}</Text>
                </View>
                <Text style={[styles.bestFor, { color: colors.textMuted }]}>{option.bestFor} · {option.daily}</Text>
                <View style={styles.chips}>{option.highlights.map((item) => <View key={item} style={[styles.chip, { backgroundColor: colors.input }]}><Ionicons color={palette.green} name="checkmark" size={13} /><Text style={[styles.chipText, { color: colors.textMuted }]}>{item}</Text></View>)}</View>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>2 · Choose your commitment</SectionTitle>
      <Text style={[styles.commitmentIntro, { color: colors.textMuted }]}>Your rates stay the same. A longer term locks them in and earns a monthly bill credit.</Text>
      <View style={styles.stack}>
        {commitmentTerms.map((option) => {
          const selected = option.id === termId;
          const current = option.id === currentPlan.term;
          return (
            <Pressable key={option.id} onPress={() => select(option.id, setTermId)} style={({ pressed }) => [pressed && styles.pressed]}>
              <Card style={[styles.term, current && styles.currentOption, selected && styles.selected]}>
                <View style={[styles.radio, { borderColor: selected ? palette.violet : colors.border }]}>{selected ? <View style={styles.radioFill} /> : null}</View>
                <View style={styles.optionCopy}>
                  <View style={styles.termTitleRow}><Text style={[styles.optionTitle, { color: colors.text }]}>{option.name}</Text>{current ? <Text style={styles.currentSmallBadge}>CURRENT PLAN</Text> : option.badge ? <Text style={styles.smallBadge}>{option.badge}</Text> : null}</View>
                  <Text style={[styles.termCredit, { color: colors.text }]}>{option.monthlyCredit}{option.monthlyCredit === 'No credit' ? '' : ' / month'}</Text>
                  <Text style={[styles.termLine, { color: colors.textMuted }]}>{option.priceTreatment}</Text>
                  <Text style={[styles.termLine, styles.termTotal]}>{option.totalCredit} total credit</Text>
                  <Text style={[styles.termLine, { color: colors.textMuted }]}>Early exit fee: {option.earlyExitFee.toLowerCase()}</Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Your selection</SectionTitle>
      <Card style={styles.summary}>
        <View style={styles.summaryIcon}><Ionicons color="#FFFFFF" name="flash" size={24} /></View>
        <View style={styles.summaryCopy}><Text style={[styles.summaryTitle, { color: colors.text }]}>{style.name}</Text><Text style={[styles.summaryMeta, { color: colors.textMuted }]}>{term.name} · {style.rate} · {term.monthlyCredit}</Text></View>
        <PrimaryButton disabled={isCurrent} label={isCurrent ? "You're on this plan" : 'Request switch'} onPress={() => void switchPlan()} />
        <Pressable onPress={() => setCompareOpen(true)}><Text style={styles.compareLink}>Compare all rates and terms</Text></Pressable>
      </Card>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setCompareOpen(false)} />} onClose={() => setCompareOpen(false)} title="Plan comparison" visible={compareOpen}>
        <Text style={[styles.modalHeading, { color: colors.text }]}>Pricing styles</Text>
        {pricingStyles.map((item) => <View key={item.id} style={[styles.compareRow, { borderBottomColor: colors.border }]}><View><View style={styles.compareTitleRow}><Text style={[styles.compareTitle, { color: colors.text }]}>{item.name}</Text>{item.id === currentPlan.pricingStyle ? <Text style={styles.currentSmallBadge}>CURRENT</Text> : null}</View><Text style={[styles.compareMeta, { color: colors.textMuted }]}>{item.eyebrow}</Text></View><Text style={[styles.compareValue, { color: colors.text }]}>{item.rate}</Text></View>)}
        <Text style={[styles.modalHeading, { color: colors.text }]}>Commitment terms</Text>
        {commitmentTerms.map((item) => <View key={item.id} style={[styles.compareTermRow, { borderBottomColor: colors.border }]}><View style={styles.compareTitleRow}><Text style={[styles.compareTitle, { color: colors.text }]}>{item.name}</Text>{item.id === currentPlan.term ? <Text style={styles.currentSmallBadge}>CURRENT</Text> : item.badge ? <Text style={styles.smallBadge}>{item.badge}</Text> : null}</View><Text style={[styles.compareTermCredit, { color: colors.text }]}>{item.monthlyCredit}{item.monthlyCredit === 'No credit' ? '' : ' / month'}</Text><Text style={[styles.compareMeta, { color: colors.textMuted }]}>{item.priceTreatment}</Text><Text style={[styles.compareMeta, styles.termTotal]}>{item.totalCredit} total credit</Text><Text style={[styles.compareMeta, { color: colors.textMuted }]}>Early exit fee: {item.earlyExitFee.toLowerCase()}</Text></View>)}
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sparkyAction: { maxWidth: 154, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7 },
  sparkyActionText: { flexShrink: 1, color: palette.violet, fontSize: 10, lineHeight: 13, fontWeight: '900' },
  commitmentIntro: { marginTop: -8, marginBottom: 11, fontSize: 11, lineHeight: 16 },
  stack: { gap: 10 }, pressed: { opacity: 0.8 }, option: { overflow: 'hidden' }, currentOption: { borderColor: palette.green, borderWidth: 2 }, selected: { borderColor: palette.violet, borderWidth: 2 },
  badge: { position: 'absolute', top: 0, right: 0, color: '#FFFFFF', backgroundColor: palette.violet, borderBottomLeftRadius: 12, paddingHorizontal: 10, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  currentBadge: { position: 'absolute', top: 0, right: 0, color: '#FFFFFF', backgroundColor: palette.green, borderBottomLeftRadius: 12, paddingHorizontal: 10, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 }, radio: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 11 }, radioFill: { width: 11, height: 11, borderRadius: 6, backgroundColor: palette.violet }, optionCopy: { flex: 1 }, optionTitle: { fontSize: 15, fontWeight: '900' }, eyebrow: { marginTop: 2, color: palette.violet, fontSize: 10, fontWeight: '800' }, rate: { maxWidth: 105, fontSize: 12, fontWeight: '900', textAlign: 'right' }, bestFor: { marginTop: 10, fontSize: 11, lineHeight: 16 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, chip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 5 }, chipText: { fontSize: 9, fontWeight: '700' },
  term: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 15 }, termTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, termCredit: { marginTop: 8, fontSize: 16, lineHeight: 20, fontWeight: '900' }, termLine: { marginTop: 4, fontSize: 11, lineHeight: 16 }, termTotal: { color: palette.violet, fontWeight: '800' }, smallBadge: { color: '#FFFFFF', backgroundColor: palette.violet, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900' }, currentSmallBadge: { color: '#FFFFFF', backgroundColor: palette.green, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900' },
  summary: { gap: 13 }, summaryIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: palette.violet }, summaryCopy: { marginTop: -56, marginLeft: 62, minHeight: 50, justifyContent: 'center' }, summaryTitle: { fontSize: 17, fontWeight: '900' }, summaryMeta: { marginTop: 3, fontSize: 11, lineHeight: 16 }, compareLink: { color: palette.violet, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  modalHeading: { marginTop: 14, marginBottom: 4, fontSize: 16, fontWeight: '900' }, compareRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, borderBottomWidth: 1, paddingVertical: 13 }, compareTermRow: { borderBottomWidth: 1, paddingVertical: 13 }, compareTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, compareTitle: { fontSize: 13, fontWeight: '800' }, compareTermCredit: { marginTop: 7, fontSize: 13, lineHeight: 18, fontWeight: '900' }, compareMeta: { marginTop: 3, fontSize: 10, lineHeight: 14 }, compareValue: { maxWidth: 130, fontSize: 11, fontWeight: '800', textAlign: 'right' },
});
