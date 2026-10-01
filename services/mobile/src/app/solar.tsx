import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View, type DimensionValue } from 'react-native';
import { Screen } from '@/components/screen';
import { Card, PrimaryButton } from '@/components/ui';
import { apiJson, apiPath } from '@/lib/backend-client';
import { loadPlans, type PricingStyle } from '@/lib/plans-data';
import { calculateSolar, centsToNzd, energy, money, numeric, solarConfig, type SolarResult } from '@/lib/solar';
import { useAuth } from '@/providers/auth';
import { useAppTheme } from '@/theme';

type Fields = Record<'kw' | 'cost' | 'demand' | 'generation' | 'importCents' | 'solarImportCents' | 'exportCents' | 'daily' | 'solarDaily' | 'credit' | 'solarCredit', string>;
type FieldKey = keyof Fields;
type DemandSummary = { available: boolean; annual_kwh: number | null; note: string };

const startingFields: Fields = {
  kw: '5', cost: '11500', demand: '', generation: '', importCents: '30', solarImportCents: '30',
  exportCents: '15', daily: '0', solarDaily: '0', credit: '0', solarCredit: '0',
};

function planDollarAmount(value: string): number | null {
  const match = value.trim().match(/^\$\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function NumberField({ label, value, onChange, optional = false }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean }) {
  const { colors } = useAppTheme();
  return <View style={styles.field}>
    <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}{optional ? ' · optional' : ''}</Text>
    <TextInput accessibilityLabel={label} keyboardType="decimal-pad" onChangeText={onChange} placeholder={optional ? 'Use city model' : 'Enter a value'} placeholderTextColor={colors.textMuted} selectTextOnFocus style={[styles.fieldInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} value={value} />
  </View>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, { backgroundColor: selected ? colors.primary : colors.input, borderColor: selected ? colors.primary : colors.border }]}>
    <Text style={[styles.choiceText, { color: selected ? colors.onPrimary : colors.text }]}>{label}</Text>
  </Pressable>;
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return <View style={[styles.stat, { borderBottomColor: colors.border }]}><Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.statValue, { color: colors.text }]}>{value}</Text></View>;
}

export default function SolarScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { plan: routePlan } = useLocalSearchParams<{ plan?: string | string[] }>();
  const planId = Array.isArray(routePlan) ? routePlan[0] : routePlan;
  const [plan, setPlan] = useState<PricingStyle | null>(null);
  const [planError, setPlanError] = useState('');
  const [fields, setFields] = useState<Fields>(startingFields);
  const [mode, setMode] = useState<'example' | 'quote'>('example');
  const [location, setLocation] = useState('Auckland');
  const [selfUse, setSelfUse] = useState(0.5);
  const [accountDemand, setAccountDemand] = useState<number | null>(null);
  const demandEdited = useRef(false);
  const [accountNote, setAccountNote] = useState('Checking this account’s usage history…');
  const [demandOrigin, setDemandOrigin] = useState('Customer-provided representative annual demand');
  const [result, setResult] = useState<SolarResult | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [chargesOpen, setChargesOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    if (!session?.customerId) {
      setPlanError('Sign in to load plan rates.');
      return;
    }
    const controller = new AbortController();
    void loadPlans(session.customerId, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      const selected = data.pricingStyles.find((item) => item.id === planId) ?? data.pricingStyles.find((item) => item.id === data.currentPlan.pricingStyle) ?? data.pricingStyles[0];
      if (!selected) throw new Error('No plan rates are available.');
      const planRate = planDollarAmount(selected.rates[0]?.value ?? selected.rate);
      if (selected.id === 'anytime' && planRate === null) throw new Error('The plan import rate could not be read.');
      const initialRate = selected.id === 'anytime' ? planRate! * 100 : solarConfig.exampleImportRate * 100;
      const dailyCharge = planDollarAmount(selected.daily);
      if (dailyCharge === null) throw new Error('The plan daily charge could not be read.');
      setPlan(selected);
      setFields((current) => ({ ...current, importCents: String(initialRate), solarImportCents: String(initialRate), exportCents: String(solarConfig.exportRate * 100), daily: String(dailyCharge), solarDaily: String(dailyCharge) }));
      setPlanError('');
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setPlanError(failure instanceof Error ? failure.message : 'Plan rates could not be loaded.');
    });
    return () => controller.abort();
  }, [session?.customerId, planId]);

  useEffect(() => {
    if (!session?.customerId) {
      setAccountNote('Sign in to load annual demand, or enter a representative annual value.');
      return;
    }
    const controller = new AbortController();
    void apiJson<DemandSummary>(apiPath('/api/households/{customer_id}/annual-demand', { customer_id: session.customerId }), { signal: controller.signal }).then((summary) => {
      if (controller.signal.aborted) return;
      if (summary.available && summary.annual_kwh !== null) {
        const demand = Math.round(summary.annual_kwh * 10) / 10;
        setAccountDemand(demand);
        if (!demandEdited.current) {
          setFields((current) => ({ ...current, demand: String(demand) }));
          setDemandOrigin(summary.note);
        }
        setAccountNote('Annual demand loaded from your account’s usage history.');
      } else {
        setAccountNote(summary.note);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setAccountNote('Annual demand could not be loaded. Enter a representative annual value.');
    });
    return () => controller.abort();
  }, [session?.customerId]);

  const changed = () => { setStale(true); setError(''); };
  const update = (key: FieldKey, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (key === 'demand') {
      demandEdited.current = true;
      setDemandOrigin('Customer-provided representative annual demand');
    }
    changed();
  };
  const field = (key: FieldKey, label: string, optional = false) => <NumberField key={key} label={label} onChange={(value) => update(key, value)} optional={optional} value={fields[key]} />;
  const calculate = () => {
    if (!plan) return;
    try {
      const n = (key: FieldKey) => numeric(fields[key], key);
      const next = calculateSolar({
        panelKw: n('kw'), installedCost: n('cost'), annualDemand: n('demand'), location,
        generationOverride: fields.generation.trim() ? n('generation') : null, selfUse,
        importRate: centsToNzd(n('importCents')), solarImportRate: centsToNzd(n('solarImportCents')),
        exportRate: centsToNzd(n('exportCents')), baselineDaily: n('daily'), solarDaily: n('solarDaily'),
        baselineCredit: n('credit'), solarCredit: n('solarCredit'), operatingCost: solarConfig.annualMaintenanceAllowance,
      });
      setResult(next);
      setStale(false);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check your inputs.');
      setStale(true);
    }
  };

  const rateNote = plan?.id === 'anytime'
    ? plan.name + ': using its demonstration marginal energy rate, not total bill divided by usage.'
    : (plan?.name ?? 'This plan') + ' needs interval pricing. This is an example flat-rate calculation, not your account-specific bill forecast; it does not price free weekend hours or time-of-use bands.';

  return <Screen contentStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Ionicons color={colors.text} name="arrow-back" size={19} /><Text style={[styles.backText, { color: colors.text }]}>Back to plans</Text></Pressable>
    <View style={styles.heading}><Ionicons color={colors.icons.energy} name="sunny-outline" size={27} /><Text style={[styles.title, { color: colors.text }]}>Explore solar savings</Text></View>
    <Text style={[styles.intro, { color: colors.textMuted }]}>See how rooftop solar could affect your bill, using your electricity usage and a few details about your home.</Text>
    {planError ? <Text accessibilityRole="alert" style={styles.error}>{planError}</Text> : !plan ? <Text style={{ color: colors.textMuted }}>Loading plan rates…</Text> : <>
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your solar scenario</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>How would you like to explore?</Text>
        <View style={styles.choices}><Choice label="Example system" onPress={() => { setMode('example'); setFields((current) => ({ ...current, kw: '5', cost: '11500' })); changed(); }} selected={mode === 'example'} /><Choice label="My solar quote" onPress={() => { setMode('quote'); changed(); }} selected={mode === 'quote'} /></View>
        {mode === 'example' ? <>
          <Text style={[styles.label, { color: colors.textMuted }]}>Example system</Text>
          <View style={styles.choices}>{solarConfig.systems.map((system) => <Choice key={system.kw} label={system.kw + ' kW · ' + money(system.cost)} onPress={() => { setFields((current) => ({ ...current, kw: String(system.kw), cost: String(system.cost) })); changed(); }} selected={Number(fields.kw) === system.kw} />)}</View>
          <Text style={[styles.help, { color: colors.textMuted }]}>Indicative national costs, including standard installation and GST. Not supplier offers; extra roof or electrical work may cost more.</Text>
        </> : <>
          {field('kw', 'Panel capacity (kW DC)')}
          {field('cost', 'Installed price (NZD, incl. GST)')}
          <Text style={[styles.help, { color: colors.textMuted }]}>Confirm your quote includes all installation work. GST is already included.</Text>
        </>}
        <Text style={[styles.label, { color: colors.textMuted }]}>Reference location</Text>
        <View style={styles.choices}>{[...Object.keys(solarConfig.locations), 'Other location'].map((city) => <Choice key={city} label={city} onPress={() => { setLocation(city); changed(); }} selected={location === city} />)}</View>
        <Text style={[styles.help, { color: colors.textMuted }]}>Example city conditions assume a north-facing, 30-degree roof and equal panel DC / inverter AC capacity. An installer should assess shade and roof suitability.</Text>
        {field('generation', 'Installer annual generation (kWh)', location !== 'Other location')}
        <Text style={[styles.help, { color: colors.textMuted }]}>An installer estimate replaces modelled generation; it is required for Other location.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Electricity you use</Text>
        <Text style={[styles.help, { color: colors.textMuted }]}>{accountNote}</Text>
        {field('demand', 'Annual household demand (kWh)')}
        {accountDemand !== null && Number(fields.demand) !== accountDemand ? <Pressable accessibilityRole="button" onPress={() => { update('demand', String(accountDemand)); demandEdited.current = false; setDemandOrigin('Restored from this account’s usage history'); }}><Text style={[styles.link, { color: colors.primary }]}>Restore account demand: {energy(accountDemand)}/year</Text></Pressable> : null}
        <Text style={[styles.help, { color: colors.textMuted }]}>We use your 365-day electricity history when available. Otherwise, we estimate annual use from available daily usage. A shorter history may miss seasonal changes.</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>Solar self-use assumption</Text>
        <Text style={[styles.help, { color: colors.textMuted }]}>The share of generated electricity you use directly at home.</Text>
        <View style={styles.choices}>{solarConfig.scenarios.map((item) => <Choice key={item.label} label={item.label + ' ' + item.fraction * 100 + '%'} onPress={() => { setSelfUse(item.fraction); changed(); }} selected={selfUse === item.fraction} />)}</View>
        <Text style={[styles.help, { color: colors.textMuted }]}>Scenarios, not researched averages or occupancy predictions. Annual matching cannot establish when electricity is consumed.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Rates and running costs</Text>
        <Text style={[styles.callout, { color: colors.text, backgroundColor: colors.surfaceRaised }]}>{rateNote}</Text>
        {field('importCents', 'Import rate before solar (c/kWh)')}
        {field('solarImportCents', 'Import rate after solar (c/kWh)')}
        {field('exportCents', 'Kea example export rate (c/kWh)')}
        <Text style={[styles.help, { color: colors.textMuted }]}>Default 15c/kWh is a prototype assumption, not a confirmed Kea offer. No GST is added to export payments for non-GST-registered households.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: chargesOpen }} onPress={() => setChargesOpen(!chargesOpen)} style={styles.disclosure}><Text style={[styles.disclosureText, { color: colors.text }]}>Daily charges and eligible credits</Text><Ionicons color={colors.text} name={chargesOpen ? 'chevron-up' : 'chevron-down'} size={20} /></Pressable>
        {chargesOpen ? <>
          <Text style={[styles.help, { color: colors.textMuted }]}>Fixed charges continue after solar. Enter only credits you remain eligible for during this year. Credits default to zero because eligibility and remaining term are unverified. Do not include export credits here.</Text>
          {field('daily', 'Daily charge before (NZD)')}
          {field('solarDaily', 'Daily charge after (NZD)')}
          {field('credit', 'Eligible annual credits before (NZD)')}
          {field('solarCredit', 'Eligible annual credits after (NZD)')}
        </> : null}
        <Text style={[styles.maintenance, { color: colors.textMuted }]}>Includes an assumed {money(solarConfig.annualMaintenanceAllowance)} per year for maintenance and replacements.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Calculate solar savings" onPress={calculate} />
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.badge, { color: colors.icons.energy }]}>BASED ON ASSUMED SOLAR SELF-USE</Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your estimated savings</Text>
        {!result ? <Text style={[styles.help, { color: colors.textMuted }]}>Choose your inputs and calculate to see annual savings and simple payback.</Text> : stale ? <Text style={[styles.callout, { color: colors.text, backgroundColor: colors.surfaceRaised }]}>Results are outdated. Recalculate after changing your inputs.</Text> : <>
          <Text style={[styles.help, { color: colors.textMuted }]}>{rateNote} {demandOrigin}.</Text>
          <View style={styles.hero}><Text style={styles.heroLabel}>Estimated annual net savings</Text><Text style={styles.heroValue}>{result.display.netBenefit}</Text><Text style={styles.heroNote}>After {money(result.input.operatingCost)}/year maintenance and replacement allowance</Text></View>
          <Stat label="Estimated simple payback" value={result.display.payback} />
          <Stat label="Upfront system cost" value={result.display.upfront} />
          <Stat label="Annual bill savings before maintenance" value={result.display.saving} />
          <Stat label="Annual solar generation" value={result.display.generation} />
          <Stat label="Solar used at home" value={energy(result.raw.selfUsed)} />
          <Stat label="Solar exported" value={energy(result.raw.exported)} />
          <Stat label="Remaining grid imports" value={energy(result.raw.gridImports)} />
          <Text style={[styles.subTitle, { color: colors.text }]}>Annual bill comparison</Text>
          <Text style={[styles.help, { color: colors.textMuted }]}>Scenario bills, not verified account forecasts. Import charges include GST.</Text>
          {([['Before solar', result.raw.baselineBill], ['After solar', result.raw.solarBill]] as const).map(([label, amount]) => {
            const max = Math.max(Math.abs(result.raw.baselineBill), Math.abs(result.raw.solarBill), 1);
            const width = (Math.abs(amount) / max * 100).toFixed(1) + '%';
            return <View key={label} style={styles.billRow}><View style={styles.billHeading}><Text style={[styles.billLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.billValue, { color: colors.text }]}>{money(amount)}</Text></View><View style={[styles.barTrack, { backgroundColor: colors.input }]}><View style={[styles.barFill, { width: width as DimensionValue, backgroundColor: colors.primary }]} /></View></View>;
          })}
          {result.raw.solarBill < 0 ? <Text style={[styles.help, { color: colors.textMuted }]}>A negative bill is net credit under these assumptions, subject to retailer settlement terms, not an automatic cash payout.</Text> : null}
          {result.raw.selfUsed === result.input.annualDemand ? <Text style={[styles.help, { color: colors.textMuted }]}>Self-use is capped by annual demand. This does not prove that demand and generation coincide.</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: methodOpen }} onPress={() => setMethodOpen(!methodOpen)} style={styles.disclosure}><Text style={[styles.disclosureText, { color: colors.text }]}>How we calculated this</Text><Ionicons color={colors.text} name={methodOpen ? 'chevron-up' : 'chevron-down'} size={20} /></Pressable>
          {methodOpen ? <View style={styles.method}>
            <Text style={[styles.help, { color: colors.textMuted }]}>{result.modelVersion} · reference checked {solarConfig.referenceDate}. Figures are rounded for display; calculations retain full precision.</Text>
            <Stat label="Panel capacity" value={result.input.panelKw + ' kW DC'} /><Stat label="Annual demand" value={energy(result.input.annualDemand)} /><Stat label="Reference location" value={result.input.location} /><Stat label="Installer generation" value={result.input.generationOverride === null ? 'Not supplied' : energy(result.input.generationOverride)} /><Stat label="Solar self-use" value={result.input.selfUse * 100 + '%'} /><Stat label="Import before / after" value={money(result.input.importRate) + ' / ' + money(result.input.solarImportRate) + ' per kWh'} /><Stat label="Export rate" value={money(result.input.exportRate) + ' per kWh'} /><Stat label="Daily charge before / after" value={money(result.input.baselineDaily) + ' / ' + money(result.input.solarDaily)} /><Stat label="Eligible annual credits before / after" value={money(result.input.baselineCredit) + ' / ' + money(result.input.solarCredit)} />
            <Text style={[styles.help, { color: colors.textMuted }]}>Demand: {demandOrigin}. Capacity and price: {mode === 'example' ? 'EECA national example' : 'Customer quote'}. Generation: {fields.generation.trim() ? 'installer estimate' : 'city-site model'}. Self-use: product scenario assumption.</Text>
            <Text style={[styles.help, { color: colors.textMuted }]}>Self-used solar = smaller of generation × self-use assumption and annual demand. Export = generation − self-use. Grid imports = demand − self-use.</Text>
            <Text style={[styles.help, { color: colors.textMuted }]}>Each bill = imports × its import rate + 365 × its daily charge − eligible annual credits. The solar bill also subtracts export value once. Bill saving = before − after. Annual net savings = bill saving − maintenance and replacement allowance. Simple payback = installed cost ÷ positive annual net savings.</Text>
            <Stat label="Export credit" value={money(result.raw.exportCredit)} /><Stat label="Avoided purchases at original import rate" value={money(result.raw.avoidedImportValue)} />
            {solarConfig.sources.map((source) => <Pressable accessibilityRole="link" key={source.id} onPress={() => void Linking.openURL(source.url)}><Text style={[styles.link, { color: colors.primary }]}>{source.id}: {source.title} · {source.date}</Text></Pressable>)}
          </View> : null}
        </>}
        <Text style={[styles.callout, { color: colors.text, backgroundColor: colors.surfaceRaised }]}>Indicative estimates, not an installation quote or guaranteed return. Roof suitability requires an installer assessment.</Text>
        <Text style={[styles.help, { color: colors.textMuted }]}>For non-GST-registered households. Excludes batteries, EV modelling, financing, future tariff changes and degradation. Individual replacement events are not modelled. The 25-year display horizon is not a warranty or lifetime forecast.</Text>
      </Card>
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 55 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backText: { fontSize: 14, fontWeight: '700' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 26, lineHeight: 31, fontWeight: '800' },
  intro: { fontSize: 15, lineHeight: 22, marginTop: -7 },
  card: { marginTop: 2 },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: '800', marginBottom: 10 },
  subTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800', marginTop: 18 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 10 },
  help: { fontSize: 13, lineHeight: 19, marginTop: 7 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9, marginBottom: 8 },
  choice: { minHeight: 44, justifyContent: 'center', borderRadius: 13, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  choiceText: { fontSize: 13, fontWeight: '700' },
  field: { marginTop: 14, gap: 7 },
  fieldLabel: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  fieldInput: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontSize: 16 },
  callout: { fontSize: 13, lineHeight: 19, borderRadius: 13, padding: 12, marginTop: 12 },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 16 },
  disclosureText: { fontSize: 15, fontWeight: '700' },
  maintenance: { fontSize: 13, lineHeight: 20, marginTop: 18, marginBottom: 17 },
  error: { color: '#E82127', fontSize: 14, lineHeight: 20, marginTop: 9 },
  link: { fontSize: 13, lineHeight: 20, fontWeight: '700', marginTop: 9 },
  badge: { fontSize: 11, letterSpacing: 0.6, fontWeight: '800', marginBottom: 6 },
  hero: { borderRadius: 16, padding: 18, marginTop: 16, marginBottom: 8, backgroundColor: '#4A25FF' },
  heroLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  heroValue: { color: '#FFFFFF', fontSize: 31, lineHeight: 39, fontWeight: '900', marginVertical: 4 },
  heroNote: { color: '#FFFFFF', fontSize: 13, lineHeight: 19, marginTop: 7 },
  stat: { borderBottomWidth: 1, paddingVertical: 12, gap: 4 },
  statLabel: { fontSize: 13, lineHeight: 19 },
  statValue: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  billRow: { marginTop: 15, gap: 7 },
  billHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  billLabel: { fontSize: 14 },
  billValue: { fontSize: 15, fontWeight: '800' },
  barTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  method: { gap: 5 },
});
