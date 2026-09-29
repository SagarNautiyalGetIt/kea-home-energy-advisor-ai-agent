import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Screen } from '@/components/screen';
import { EnterItem, ScreenEnter } from '@/components/motion';
import { IconButton, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { PlanCard } from '@/components/PlanCard';
import { loadPlans, requestPlanSwitch, type CommitmentTerm, type PricingStyle } from '@/lib/plans-data';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

const width = Dimensions.get('window').width;
const cardWidth = Math.min(342, width - 72);
const gap = 12;
const interval = cardWidth + gap;
const inset = (width - cardWidth) / 2;

function termPhoto(id: string) {
  switch (id) {
    case 'flexible':
      return require('../../../assets/kea/term-flexible.jpg');
    case '6-months':
      return require('../../../assets/kea/term-6-months.jpg');
    case '12-months':
      return require('../../../assets/kea/term-12-months.jpg');
    default:
      return undefined;
  }
}

export default function PlansScreen() {
  const { colors } = useAppTheme(); const { session } = useAuth(); const { showToast } = useToast(); const list = useRef<FlatList<PricingStyle>>(null); const scrollRef = useRef<ScrollView>(null);
  const [plans, setPlans] = useState<PricingStyle[]>([]); const [terms, setTerms] = useState<CommitmentTerm[]>([]); const [current, setCurrent] = useState({ pricingStyle: '', term: '' }); const [planId, setPlanId] = useState(''); const [termId, setTermId] = useState(''); const [viewedIndex, setViewedIndex] = useState(0); const [error, setError] = useState<string>();
  const plan = plans.find((item) => item.id === planId); const term = terms.find((item) => item.id === termId); const isCurrent = planId === current.pricingStyle && termId === current.term;
  useEffect(() => { const controller = new AbortController(); void loadPlans(session?.customerId ?? '', controller.signal).then((data) => { setPlans(data.pricingStyles); setTerms(data.commitmentTerms); setCurrent(data.currentPlan); const recommended = data.pricingStyles.find((item) => item.badge) ?? data.pricingStyles[0]; const initialPlan = data.currentPlan.pricingStyle || recommended?.id || data.pricingStyles[0]?.id || ''; const initialTerm = data.currentPlan.term || data.commitmentTerms[0]?.id || ''; const initialIndex = Math.max(0, data.pricingStyles.findIndex((item) => item.id === initialPlan)); setViewedIndex(initialIndex); setPlanId(initialPlan); setTermId(initialTerm); }).catch((value: unknown) => { if (value instanceof Error && value.name !== 'AbortError') setError(value.message); }); return () => controller.abort(); }, [session?.customerId]);
  const viewPlan = (index: number) => { if (!plans[index]) return; setViewedIndex(index); list.current?.scrollToOffset({ offset: index * interval, animated: true }); };
  const choosePlan = (id: string) => { setPlanId(id); void Haptics.selectionAsync(); };
  const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => setViewedIndex(Math.max(0, Math.min(plans.length - 1, Math.round(event.nativeEvent.contentOffset.x / interval))));
  const selectTerm = (id: string) => { setTermId(id); void Haptics.selectionAsync(); requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 300, animated: true })); };
  const switchPlan = async () => { if (!plan || !term) return; try { await requestPlanSwitch(session?.customerId ?? '', plan.id, term.id); showToast(`${plan.name} with the ${term.name} term requested`); } catch (value: unknown) { showToast(value instanceof Error ? value.message : 'Plan switch could not be requested.', 'warning'); } };
  if (!plan || !term) return <Screen scrollRef={scrollRef}><PageHeader title="Plans" /><Text style={[styles.loading, { color: error ? palette.red : colors.textMuted }]}>{error ?? 'Loading plans…'}</Text></Screen>;
  return <Screen scrollRef={scrollRef} contentStyle={styles.content}>
    <ScreenEnter style={styles.screenEnter}>
    <PageHeader title="Plans" subtitle="Save smartly" action={<IconButton icon="sparkles" label="Ask Sparky AI to recommend a plan" onPress={() => router.push({ pathname: '/assistant', params: { plan: `${plan.name} (${term.name})` } })} />} />
    <SectionTitle>Your commitment</SectionTitle>
    <View style={styles.terms}>{terms.map((item, index) => { const selected = item.id === termId; const currentTerm = item.id === current.term; const photo = termPhoto(item.id); return <EnterItem index={index} key={item.id}><Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => selectTerm(item.id)}><View style={[styles.termCard, { borderColor: selected ? palette.white : colors.border }]}>{photo ? <Image resizeMode="cover" source={photo} style={styles.termPhoto} /> : null}{photo ? <View style={styles.termScrim} /> : null}{photo ? <BlurView intensity={55} style={StyleSheet.absoluteFill} tint="dark" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: selected ? colors.surfaceRaised : colors.surface }]} />}<View style={styles.termBody}><View style={[styles.radio, { borderColor: selected ? palette.white : colors.border }]}>{selected ? <View style={styles.dot} /> : null}</View><View style={styles.termCopy}><View style={styles.termTitle}><Text style={[styles.termName, { color: colors.text }]}>{item.name}</Text>{currentTerm ? <Text style={styles.currentBadge}>CURRENT</Text> : null}</View><Text style={[styles.termDetail, { color: colors.textMuted }]}>{item.priceTreatment}</Text><Text style={[styles.termFine, { color: colors.textMuted }]}>{item.earlyExitFee}</Text></View><View><Text style={[styles.credit, { color: colors.text }]}>{item.monthlyCredit}</Text><Text style={[styles.creditLabel, { color: colors.textMuted }]}>{item.monthlyCredit === 'No credit' ? 'monthly credit' : '/ month'}</Text></View></View></View></Pressable></EnterItem>; })}</View>
    <View style={styles.planHead}><View><SectionTitle>Your power plan</SectionTitle><Text style={[styles.copy, { color: colors.textMuted }]}>Swipe to compare each way of paying for power.</Text></View></View>
    <FlatList ref={list} style={styles.carouselViewport} data={plans} horizontal initialScrollIndex={viewedIndex} getItemLayout={(_, index) => ({ length: interval, offset: index * interval, index })} keyExtractor={(item) => item.id} renderItem={({ item, index }) => <View style={styles.cardItem}><PlanCard current={item.id === current.pricingStyle} onPress={() => viewPlan(index)} onSelect={() => choosePlan(item.id)} plan={item} selected={item.id === planId} /></View>} contentContainerStyle={styles.carousel} decelerationRate="fast" disableIntervalMomentum onMomentumScrollEnd={onEnd} showsHorizontalScrollIndicator={false} snapToInterval={interval} />
    <View style={styles.dots}>{plans.map((item, index) => <View key={item.id} style={[styles.pageDot, { backgroundColor: index === viewedIndex ? palette.white : colors.border }, index === viewedIndex && styles.activeDot]} />)}</View>
    <View style={[styles.selection, { backgroundColor: colors.input, borderColor: colors.border }]}><View style={styles.selectionTop}><Ionicons color={palette.green} name="checkmark-circle" size={20} /><View style={styles.selectionCopy}><Text style={[styles.selectionLabel, { color: colors.textMuted }]}>YOUR SELECTION</Text><Text style={[styles.selectionValue, { color: colors.text }]}>{plan.name} · {term.name}</Text></View></View><PrimaryButton disabled={isCurrent} label={isCurrent ? "You're on this plan" : 'Send switch request'} onPress={() => void switchPlan()} /></View>
    </ScreenEnter>
  </Screen>;
}
const styles = StyleSheet.create({ screenEnter: { flex: 1 }, content: { paddingHorizontal: 18, paddingBottom: 46 }, loading: { marginTop: 10, fontSize: 13 }, aiButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20 }, aiButtonText: { fontWeight: 'bold', fontSize: 14 }, intro: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, marginBottom: 1, padding: 12 }, introText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '700' }, copy: { marginTop: -7, fontSize: 11, lineHeight: 16, fontWeight: '600' }, terms: { gap: 9, marginTop: 14 }, termCard: { minHeight: 79, borderWidth: 1, borderRadius: 19, overflow: 'hidden' }, termBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 }, termPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }, termScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.30)' }, radio: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 11 }, dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: palette.white }, termCopy: { flex: 1, minWidth: 0 }, termTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 }, termName: { fontSize: 14, fontWeight: '900' }, currentBadge: { color: palette.green, borderColor: palette.green, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 7, fontWeight: '900' }, termDetail: { marginTop: 3, fontSize: 10, fontWeight: '700' }, termFine: { marginTop: 2, fontSize: 9, fontWeight: '600' }, credit: { fontSize: 18, fontWeight: '900', textAlign: 'right' }, creditLabel: { marginTop: 2, fontSize: 8, fontWeight: '800' }, planHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }, counter: { marginBottom: 14, fontSize: 11, fontWeight: '800' }, carouselViewport: { marginHorizontal: -18, marginTop: 22 }, carousel: { paddingLeft: inset, paddingRight: inset }, cardItem: { width: cardWidth, marginRight: gap, paddingVertical: 7 }, dots: { flexDirection: 'row', alignSelf: 'center', gap: 6, marginTop: 7 }, pageDot: { width: 6, height: 6, borderRadius: 4 }, activeDot: { width: 20 }, selection: { gap: 13, borderWidth: 1, borderRadius: 17, marginTop: 19, padding: 13 }, selectionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, selectionCopy: { flex: 1 }, selectionLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.65 }, selectionValue: { marginTop: 3, fontSize: 12, fontWeight: '900' }, });
