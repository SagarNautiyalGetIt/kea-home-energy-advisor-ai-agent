import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarPicker, type CalendarSelectionMode } from '@/components/calendar-picker';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, Segmented, SectionTitle } from '@/components/ui';
import { UsageChart } from '@/components/usage-chart';
import { getUsageView, type UsageBand, type UsagePeriod, type UsageViewData } from '@/lib/usage-data';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

type Period = UsagePeriod;
type Unit = 'kwh' | 'cost';
type ComparisonSelection = { first: string; second: string };

const periodOptions = [
  { value: 'daily' as const, label: 'Day' },
  { value: 'weekly' as const, label: 'Week' },
  { value: 'monthly' as const, label: 'Month' },
];

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dailyChartLabels = ['12', '', '', '3', '', '', '6', '', '', '9', '', '', '12', '', '', '3', '', '', '6', '', '', '', '', '', '12'];
const dailyTimeBands = [{ label: 'AM', startIndex: 0, endIndex: 12 }, { label: 'PM', startIndex: 12, endIndex: 24 }];
const unavailableBands: UsageBand[] = [
  { key: 'peak', label: 'Peak usage', window: null, kwh: null, costNzd: null },
  { key: 'offPeak', label: 'Off-peak usage', window: null, kwh: null, costNzd: null },
  { key: 'night', label: 'Night usage', window: null, kwh: null, costNzd: null },
];

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function shortDate(date: Date) {
  return `${date.getDate()} ${monthLabels[date.getMonth()]}`;
}

function compactNumericDate(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function weekRangeLabel(selected: string) {
  const selectedDate = parseDate(selected);
  const start = addDays(selectedDate, -((selectedDate.getDay() + 6) % 7));
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) return `${shortDate(start)} ${start.getFullYear()}–${shortDate(end)} ${end.getFullYear()}`;
  if (start.getMonth() !== end.getMonth()) return `${shortDate(start)}–${shortDate(end)} ${end.getFullYear()}`;
  return `${start.getDate()}–${shortDate(end)} ${end.getFullYear()}`;
}

function weekDates(selected: string) {
  const selectedDate = parseDate(selected);
  const start = addDays(selectedDate, -((selectedDate.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function selectionLabel(period: Period, selected: string) {
  const selectedDate = parseDate(selected);
  if (period === 'daily') return `${shortDate(selectedDate)} ${selectedDate.getFullYear()}`;
  if (period === 'weekly') return weekRangeLabel(selected);
  return `${monthLabels[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
}

function shiftMonth(selected: string, amount: number) {
  const current = parseDate(selected);
  const targetMonth = new Date(current.getFullYear(), current.getMonth() + amount, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  targetMonth.setDate(Math.min(current.getDate(), lastDay));
  return toDateValue(targetMonth);
}

function previousPeriodDate(period: Period, selected: string) {
  if (period === 'monthly') return shiftMonth(selected, -1);
  return toDateValue(addDays(parseDate(selected), period === 'weekly' ? -7 : -1));
}

function shiftPeriodDate(period: Period, selected: string, amount: number) {
  if (period === 'monthly') return shiftMonth(selected, amount);
  return toDateValue(addDays(parseDate(selected), amount * (period === 'weekly' ? 7 : 1)));
}

function compactWeekLabel(selected: string) {
  const dates = weekDates(selected);
  const start = dates[0] as Date;
  const end = dates[6] as Date;
  const startDay = String(start.getDate()).padStart(2, '0');
  const endDay = String(end.getDate()).padStart(2, '0');
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) return `${startDay}-${endDay} ${monthLabels[end.getMonth()]} ${end.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear()) return `${startDay} ${monthLabels[start.getMonth()]}-${endDay} ${monthLabels[end.getMonth()]} ${end.getFullYear()}`;
  return `${startDay} ${monthLabels[start.getMonth()]} ${start.getFullYear()}-${endDay} ${monthLabels[end.getMonth()]} ${end.getFullYear()}`;
}

function weekMonthBands(selected: string, row = 0) {
  const dates = weekDates(selected);
  const bands: { label: string; startIndex: number; endIndex: number; row: number }[] = [];
  dates.forEach((value, index) => {
    const label = monthLabels[value.getMonth()] ?? '';
    const previous = bands.at(-1);
    if (previous?.label === label) previous.endIndex = index;
    else bands.push({ label, startIndex: index, endIndex: index, row });
  });
  return bands;
}

function comparisonSelectionLabel(period: Period, comparison: ComparisonSelection) {
  const first = parseDate(comparison.first);
  const second = parseDate(comparison.second);
  if (period === 'weekly') return `${compactWeekLabel(comparison.first)}\n-\n${compactWeekLabel(comparison.second)}`;
  if (period === 'monthly') {
    if (first.getFullYear() === second.getFullYear()) return `${monthLabels[first.getMonth()]} vs ${monthLabels[second.getMonth()]} ${first.getFullYear()}`;
    return `${monthLabels[first.getMonth()]} ${first.getFullYear()} vs ${monthLabels[second.getMonth()]} ${second.getFullYear()}`;
  }
  if (first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth()) return `${first.getDate()} vs ${second.getDate()} ${monthLabels[first.getMonth()]} ${first.getFullYear()}`;
  return `${shortDate(first)} ${first.getFullYear()} vs ${shortDate(second)} ${second.getFullYear()}`;
}

function bandPresentation(key: UsageBand['key']) {
  if (key === 'peak') return { icon: 'flame-outline' as const, color: palette.red, tone: '#FFF0F2' };
  if (key === 'offPeak') return { icon: 'sunny-outline' as const, color: palette.amber, tone: '#FFF4D9' };
  return { icon: 'moon-outline' as const, color: palette.periwinkle, tone: '#F0EDFF' };
}

export default function UsageScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [unit, setUnit] = useState<Unit>('cost');
  const [comparisons, setComparisons] = useState<Record<Period, ComparisonSelection | null>>({ daily: null, weekly: null, monthly: null });
  const [date, setDate] = useState(() => toDateValue(new Date()));
  const [dateOpen, setDateOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<'first' | 'second'>('first');
  const [firstPeriod, setFirstPeriod] = useState(() => toDateValue(new Date()));
  const [secondPeriod, setSecondPeriod] = useState(() => toDateValue(addDays(new Date(), -7)));
  const [data, setData] = useState<UsageViewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [animationRun, setAnimationRun] = useState(0);
  const [chartActive, setChartActive] = useState(false);
  const [graphTranslateX] = useState(() => new Animated.Value(0));
  const [graphOpacity] = useState(() => new Animated.Value(1));
  const [graphScale] = useState(() => new Animated.Value(1));
  const [hintTranslateX] = useState(() => new Animated.Value(0));
  const [hintOpacity] = useState(() => new Animated.Value(0));
  const [swipeInProgress, setSwipeInProgress] = useState(false);
  const comparison = comparisons[period];
  const compare = comparison !== null;
  const chartValues = useMemo(() => {
    if (!data) return [];
    const values = unit === 'cost'
      ? data.points.every((point) => point.costNzd !== null) ? data.points.map((point) => point.costNzd as number) : []
      : data.points.map((point) => point.kwh);
    return period === 'daily' && values.length === 24 ? [...values, values[0] ?? 0] : values;
  }, [data, period, unit]);
  const chartPrevious = useMemo(() => {
    if (!data?.comparisonPoints) return undefined;
    const values = unit === 'cost'
      ? data.comparisonPoints.every((point) => point.costNzd !== null) ? data.comparisonPoints.map((point) => point.costNzd as number) : []
      : data.comparisonPoints.map((point) => point.kwh);
    return period === 'daily' && values.length === 24 ? [...values, values[0] ?? 0] : values;
  }, [data, period, unit]);
  const suffix = unit === 'cost' ? 'NZD' : 'kWh';
  const sourceLabels = data?.points.map((point) => point.axisLabel) ?? [];
  const chartLabels = period === 'daily' && sourceLabels.length === 24 ? dailyChartLabels : sourceLabels;
  const weeklyBands = period === 'weekly' && !comparison ? weekMonthBands(date) : undefined;
  const weeklyDayLabels = period === 'weekly'
    ? weekDates(comparison?.first ?? date).map((value) => comparison ? compactNumericDate(value) : String(value.getDate()))
    : undefined;
  const comparedWeeklyDayLabels = period === 'weekly' && comparison
    ? weekDates(comparison.second).map(compactNumericDate)
    : undefined;
  const tooltipLabels = data?.points.map((point) => point.tooltipLabel);
  const previousTooltipLabels = data?.comparisonPoints?.map((point) => point.tooltipLabel);
  const selectedPeriodLabel = comparison ? comparisonSelectionLabel(period, comparison) : selectionLabel(period, date);
  const bands = data?.bands ?? unavailableBands;
  const periodTitle = period === 'daily' ? "Today's total" : period === 'weekly' ? "This week's total" : "This month's total";
  const formatAmount = (kwh: number | null, costNzd: number | null) => unit === 'cost' ? costNzd === null ? '—' : `$${costNzd.toFixed(2)}` : kwh === null ? '—' : `${kwh.toFixed(1)} kWh`;
  const totalDisplay = unit === 'cost' ? data?.totalCostNzd == null ? '—' : `$${data.totalCostNzd.toFixed(2)}` : data?.totalKwh == null ? '—' : data.totalKwh.toFixed(1);

  const refresh = () => {
    setReloadToken((token) => token + 1);
    setAnimationRun((run) => run + 1);
    void Haptics.selectionAsync();
  };

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setLoading(true);
      setLoadError(null);
      setData(null);
      try {
        const result = await getUsageView({ customerId: session?.customerId ?? '', period, date, compareDate: comparison?.second, signal: controller.signal });
        if (!controller.signal.aborted) setData(result);
      } catch (error: unknown) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Usage could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [comparison?.second, date, period, reloadToken, session?.customerId]);

  useFocusEffect(useCallback(() => {
    setAnimationRun((run) => run + 1);
    hintTranslateX.setValue(0);
    hintOpacity.setValue(0);
    const hintAnimation = Animated.sequence([
      Animated.timing(hintOpacity, { duration: 220, toValue: 1, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(hintTranslateX, { duration: 360, toValue: -13, useNativeDriver: true }),
        Animated.timing(hintTranslateX, { duration: 720, toValue: 13, useNativeDriver: true }),
        Animated.timing(hintTranslateX, { duration: 360, toValue: 0, useNativeDriver: true }),
      ]),
      Animated.delay(650),
      Animated.timing(hintOpacity, { duration: 300, toValue: 0, useNativeDriver: true }),
    ]);
    hintAnimation.start();
    return () => hintAnimation.stop();
  }, [hintOpacity, hintTranslateX]));

  const shiftGraph = useCallback((direction: 'previous' | 'next') => {
    if (swipeInProgress) return;
    setSwipeInProgress(true);
    setChartActive(false);
    const amount = direction === 'previous' ? -1 : 1;
    const exitX = direction === 'next' ? -110 : 110;
    const enterX = -exitX * 0.82;
    Animated.parallel([
      Animated.timing(graphTranslateX, { duration: 190, easing: Easing.in(Easing.cubic), toValue: exitX, useNativeDriver: true }),
      Animated.timing(graphOpacity, { duration: 165, easing: Easing.in(Easing.quad), toValue: 0.08, useNativeDriver: true }),
      Animated.timing(graphScale, { duration: 190, easing: Easing.inOut(Easing.quad), toValue: 0.975, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) {
        setSwipeInProgress(false);
        return;
      }
      if (comparison) {
        const first = shiftPeriodDate(period, comparison.first, amount);
        const second = shiftPeriodDate(period, comparison.second, amount);
        setDate(first);
        setComparisons((current) => ({ ...current, [period]: { first, second } }));
      } else {
        setDate((current) => shiftPeriodDate(period, current, amount));
      }
      setAnimationRun((run) => run + 1);
      void Haptics.selectionAsync();
      graphTranslateX.setValue(enterX);
      graphScale.setValue(0.985);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(graphTranslateX, { damping: 19, mass: 0.72, stiffness: 175, toValue: 0, useNativeDriver: true }),
          Animated.timing(graphOpacity, { duration: 260, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
          Animated.spring(graphScale, { damping: 20, mass: 0.7, stiffness: 190, toValue: 1, useNativeDriver: true }),
        ]).start(() => setSwipeInProgress(false));
      });
    });
  }, [comparison, graphOpacity, graphScale, graphTranslateX, period, swipeInProgress]);

  const chartPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_event, gesture) => {
      const drag = Math.max(-72, Math.min(72, gesture.dx * 0.55));
      graphTranslateX.setValue(drag);
      graphOpacity.setValue(1 - Math.min(Math.abs(drag) / 260, 0.25));
      graphScale.setValue(1 - Math.min(Math.abs(drag) / 2200, 0.025));
    },
    onPanResponderRelease: (_event, gesture) => {
      const isHorizontalFlick = Math.abs(gesture.vx) >= 0.35 && Math.abs(gesture.dx) >= 18;
      if (Math.abs(gesture.dx) >= 48 || isHorizontalFlick) {
        // Right-to-left advances the date; left-to-right returns to the previous date.
        shiftGraph(gesture.dx < 0 ? 'next' : 'previous');
        return;
      }
      Animated.parallel([
        Animated.spring(graphTranslateX, { damping: 18, stiffness: 210, toValue: 0, useNativeDriver: true }),
        Animated.timing(graphOpacity, { duration: 150, toValue: 1, useNativeDriver: true }),
        Animated.spring(graphScale, { damping: 18, stiffness: 210, toValue: 1, useNativeDriver: true }),
      ]).start();
    },
    onPanResponderTerminate: () => {
      Animated.parallel([
        Animated.spring(graphTranslateX, { damping: 18, stiffness: 210, toValue: 0, useNativeDriver: true }),
        Animated.timing(graphOpacity, { duration: 150, toValue: 1, useNativeDriver: true }),
        Animated.spring(graphScale, { damping: 18, stiffness: 210, toValue: 1, useNativeDriver: true }),
      ]).start();
    },
  }), [graphOpacity, graphScale, graphTranslateX, shiftGraph]);

  const selectionMode: CalendarSelectionMode = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
  const changePeriod = (nextPeriod: Period) => {
    setChartActive(false);
    setPeriod(nextPeriod);
  };

  const openComparison = () => {
    if (comparison) {
      setFirstPeriod(comparison.first);
      setSecondPeriod(comparison.second);
    } else {
      setFirstPeriod(date);
      setSecondPeriod(previousPeriodDate(period, date));
    }
    setCompareTarget('first');
    setCompareOpen(true);
  };

  const applyComparison = () => {
    setDate(firstPeriod);
    setComparisons((current) => ({ ...current, [period]: { first: firstPeriod, second: secondPeriod } }));
    setCompareOpen(false);
    void Haptics.selectionAsync();
  };

  const clearComparison = () => {
    setComparisons((current) => ({ ...current, [period]: null }));
    setCompareOpen(false);
    void Haptics.selectionAsync();
  };

  return (
    <Screen onTouchStart={() => setChartActive(false)}>
      <PageHeader title="Usage" subtitle="Understand your electricity patterns" action={<Pressable accessibilityLabel="Refresh usage" onPress={refresh} style={[styles.refresh, { backgroundColor: colors.surface, borderColor: colors.border }]}>{loading ? <ActivityIndicator color={palette.violet} /> : <Ionicons color={palette.violet} name="refresh" size={20} />}</Pressable>} />
      <Segmented activeBackgroundColor={palette.violet} activeTextColor="#FFFFFF" onChange={changePeriod} options={periodOptions} value={period} />

      <View style={styles.toolbarRow}>
        <Pressable accessibilityLabel={`Choose ${period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}`} onPress={compare ? openComparison : () => setDateOpen(true)} style={({ pressed }) => [styles.toolbarButton, compare && styles.comparisonDateButton, compare && period === 'weekly' && styles.weekComparisonDateButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}><Ionicons color={palette.violet} name="calendar-outline" size={19} /><Text numberOfLines={compare && period === 'weekly' ? 3 : 2} style={[styles.toolbarButtonText, { color: colors.text }]}>{selectedPeriodLabel}</Text><Ionicons color={colors.textMuted} name="chevron-down" size={14} /></Pressable>
        <View style={[styles.toolbarButton, styles.compareButton, { backgroundColor: compare ? 'rgba(74, 37, 255, 0.18)' : colors.surface, borderColor: compare ? palette.violet : colors.border }]}><Pressable accessibilityLabel="Choose periods to compare" onPress={openComparison} style={({ pressed }) => [styles.compareMain, pressed && styles.pressed]}><Ionicons color={palette.violet} name="git-compare-outline" size={19} /><Text style={[styles.toolbarButtonText, { color: compare ? palette.violet : colors.text }]}>Compare</Text></Pressable>{compare ? <Pressable accessibilityLabel="Exit comparison mode" hitSlop={5} onPress={clearComparison} style={styles.compareClose}><Ionicons color={palette.violet} name="close" size={18} /></Pressable> : null}</View>
      </View>

      <Animated.View {...chartPanResponder.panHandlers} style={{ opacity: graphOpacity, transform: [{ translateX: graphTranslateX }, { scale: graphScale }] }}>
        <Card style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View><Text style={[styles.totalLabel, { color: colors.textMuted }]}>Selected period</Text><Text style={[styles.total, { color: colors.text }]}>{totalDisplay} <Text style={styles.suffix}>{suffix}</Text></Text></View>
            <View style={[styles.unitToggle, { backgroundColor: colors.input }]}>
              {/* Cost first — it is the default, and the lit segment belongs on the
                  left. Matches the web toggle. */}
              {(['cost', 'kwh'] as const).map((item) => <Pressable key={item} onPress={() => setUnit(item)} style={[styles.unitOption, unit === item && { backgroundColor: palette.violet }]}><Text style={[styles.unitText, { color: unit === item ? '#FFFFFF' : colors.textMuted }]}>{item === 'kwh' ? 'kWh' : '$'}</Text></Pressable>)}
            </View>
          </View>
          <Animated.View pointerEvents="none" style={[styles.swipeHint, { backgroundColor: colors.input, opacity: hintOpacity, transform: [{ translateX: hintTranslateX }] }]}><Ionicons color={palette.violet} name="chevron-back" size={14} /><Text style={[styles.swipeHintText, { color: colors.textMuted }]}>Swipe for previous or next</Text><Ionicons color={palette.violet} name="chevron-forward" size={14} /></Animated.View>
          <UsageChart accessibilityLabel={`${period} electricity usage in ${unit === 'cost' ? 'dollars' : 'kilowatt-hours'}`} active={chartActive} key={`${period}-${unit}-${date}-${compare}-${comparison?.second ?? ''}-${animationRun}`} labels={chartLabels} onActivate={() => setChartActive(true)} onDismiss={() => setChartActive(false)} previous={chartPrevious} previousTooltipLabels={previousTooltipLabels} secondaryLabels={weeklyDayLabels} tertiaryLabels={comparedWeeklyDayLabels} timeBands={period === 'daily' && chartLabels.length === 25 ? dailyTimeBands : weeklyBands} tooltipLabels={tooltipLabels} unit={unit} values={chartValues} xLabelInterval={period === 'daily' ? 3 : period === 'monthly' && chartLabels.length > 8 ? 5 : 1} />
        </Card>
      </Animated.View>

      <SectionTitle>Usage breakdown</SectionTitle>
        <View style={styles.summaryGrid}>
          <Card style={styles.summaryCard}><View style={[styles.summaryIcon, { backgroundColor: '#F0EDFF' }]}><Ionicons color={palette.violet} name="pulse-outline" size={21} /></View><Text style={[styles.summaryTitle, { color: colors.textMuted }]}>{periodTitle}</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{formatAmount(data?.totalKwh ?? null, data?.totalCostNzd ?? null)}</Text><Text style={[styles.summaryDetail, { color: colors.textMuted }]}>Current selected period</Text><View style={[styles.summaryBadge, (data?.trendPercent ?? 0) < 0 && styles.summaryBadgeDown]}><Text style={[styles.summaryBadgeText, (data?.trendPercent ?? 0) < 0 && styles.summaryBadgeTextDown]}>{data?.trendPercent == null ? '—' : `${data.trendPercent > 0 ? '+' : ''}${data.trendPercent.toFixed(2)}%`}</Text></View></Card>
          {bands.map((band) => { const presentation = bandPresentation(band.key); const share = band.kwh !== null && data?.totalKwh ? `${Math.round((band.kwh / data.totalKwh) * 100)}%` : '—'; return <Card key={band.key} style={styles.summaryCard}><View style={[styles.summaryIcon, { backgroundColor: presentation.tone }]}><Ionicons color={presentation.color} name={presentation.icon} size={21} /></View><Text style={[styles.summaryTitle, { color: colors.textMuted }]}>{band.label}</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{formatAmount(band.kwh, band.costNzd)}</Text><Text style={[styles.summaryDetail, { color: colors.textMuted }]}>{band.window ?? 'Not provided for this period'}</Text><View style={styles.shareBadge}><Text style={styles.shareBadgeText}>{share}</Text></View></Card>; })}
        </View>
      <Card style={styles.disclosure}><Ionicons color={loadError ? palette.red : palette.periwinkle} name={loadError ? 'warning-outline' : 'information-circle-outline'} size={20} /><Text style={[styles.disclosureText, { color: colors.textMuted }]}>{loadError ?? (data?.isDemo ? 'Illustrative local fixture data. The screen switches to the contracted household API when EXPO_PUBLIC_API_URL is configured.' : data?.limitation ?? `Usage supplied for ${data?.sourcePeriod ?? 'the selected period'}.`)}</Text></Card>

      <ModalSheet footer={<View style={styles.doneFooter}><View style={styles.doneButton}><PrimaryButton label="Done" onPress={() => setDateOpen(false)} /></View></View>} onClose={() => setDateOpen(false)} title={`Choose ${period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}`} visible={dateOpen}>
        <View style={styles.dateDialog}><Text style={[styles.dialogLabel, { color: colors.textMuted }]}>Selected {period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}</Text><Text style={[styles.selectedDateText, { color: colors.text }]}>{selectionLabel(period, date)}</Text><CalendarPicker key={`date-${date}`} onChange={setDate} selectionMode={selectionMode} value={date} /></View>
      </ModalSheet>

      <ModalSheet footer={<View style={styles.doneFooter}><View style={styles.doneButton}><PrimaryButton label="Done" onPress={applyComparison} /></View></View>} onClose={() => setCompareOpen(false)} title="Compare usage" visible={compareOpen}>
        <View style={styles.compareDialog}><Text style={[styles.compareHelp, { color: colors.textMuted }]}>Choose the two {period === 'daily' ? 'dates' : period === 'weekly' ? 'weeks' : 'months'} you want to compare.</Text><View style={styles.periodBoxes}><Pressable onPress={() => setCompareTarget('first')} style={[styles.periodBox, { backgroundColor: colors.input, borderColor: compareTarget === 'first' ? palette.violet : colors.border }]}><Text style={[styles.periodBoxLabel, { color: colors.textMuted }]}>First</Text><Text numberOfLines={2} style={[styles.periodBoxValue, { color: colors.text }]}>{selectionLabel(period, firstPeriod)}</Text></Pressable><Pressable onPress={() => setCompareTarget('second')} style={[styles.periodBox, { backgroundColor: colors.input, borderColor: compareTarget === 'second' ? palette.violet : colors.border }]}><Text style={[styles.periodBoxLabel, { color: colors.textMuted }]}>Second</Text><Text numberOfLines={2} style={[styles.periodBoxValue, { color: colors.text }]}>{selectionLabel(period, secondPeriod)}</Text></Pressable></View><CalendarPicker key={`${compareTarget}-${compareTarget === 'first' ? firstPeriod : secondPeriod}`} onChange={compareTarget === 'first' ? setFirstPeriod : setSecondPeriod} selectionMode={selectionMode} value={compareTarget === 'first' ? firstPeriod : secondPeriod} /></View>
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  refresh: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  toolbarRow: { flexDirection: 'row', gap: 4, marginTop: 10 }, toolbarButton: { minWidth: 0, minHeight: 50, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 14 }, comparisonDateButton: { gap: 3, paddingHorizontal: 4 }, weekComparisonDateButton: { minHeight: 72 }, toolbarButtonText: { flexShrink: 1, fontSize: 10.5, fontWeight: '900', textAlign: 'center' }, compareButton: { gap: 0, overflow: 'hidden', paddingHorizontal: 0 }, compareMain: { minWidth: 0, minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 9 }, compareClose: { width: 38, height: 32, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(74, 37, 255, 0.28)' }, pressed: { opacity: 0.78 },
  chartCard: { marginTop: 14, paddingBottom: 8 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, totalLabel: { fontSize: 11, fontWeight: '700' }, total: { marginTop: 2, fontSize: 26, fontWeight: '900' }, suffix: { fontSize: 12, color: palette.violet },
  swipeHint: { minHeight: 26, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: -5, marginBottom: 2, borderRadius: 13, paddingHorizontal: 9 }, swipeHintText: { fontSize: 8.5, lineHeight: 12, fontWeight: '800' },
  unitToggle: { flexDirection: 'row', padding: 3, borderRadius: 12 }, unitOption: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, unitText: { fontSize: 12, fontWeight: '900' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, summaryCard: { width: '48.5%', minHeight: 142, padding: 12 }, summaryIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, summaryTitle: { marginTop: 7, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }, summaryValue: { marginTop: 2, fontSize: 17, lineHeight: 20, fontWeight: '900' }, summaryDetail: { marginTop: 3, fontSize: 8.5, lineHeight: 12 }, summaryBadge: { position: 'absolute', top: 12, right: 10, borderRadius: 9, backgroundColor: '#E7F8F1', paddingHorizontal: 6, paddingVertical: 4 }, summaryBadgeDown: { backgroundColor: '#FFEDF0' }, summaryBadgeText: { color: palette.green, fontSize: 9, fontWeight: '900' }, summaryBadgeTextDown: { color: palette.red }, shareBadge: { position: 'absolute', top: 12, right: 10, borderRadius: 9, backgroundColor: '#F0EDFF', paddingHorizontal: 6, paddingVertical: 4 }, shareBadgeText: { color: palette.violet, fontSize: 9, fontWeight: '900' },
  disclosure: { flexDirection: 'row', gap: 10, marginTop: 14, padding: 14 }, disclosureText: { flex: 1, fontSize: 11, lineHeight: 16 },
  dateDialog: { gap: 10 }, dialogLabel: { fontSize: 10, fontWeight: '800', textAlign: 'center' }, selectedDateText: { marginBottom: 2, fontSize: 17, fontWeight: '900', textAlign: 'center' }, doneFooter: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }, doneButton: { width: 132 },
  compareDialog: { gap: 13 }, compareHelp: { fontSize: 12, lineHeight: 18 }, periodBoxes: { flexDirection: 'row', gap: 6 }, periodBox: { minWidth: 0, minHeight: 70, flex: 1, justifyContent: 'center', borderWidth: 1.5, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 9 }, periodBoxLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }, periodBoxValue: { marginTop: 4, fontSize: 11, lineHeight: 15, fontWeight: '900' },
});
