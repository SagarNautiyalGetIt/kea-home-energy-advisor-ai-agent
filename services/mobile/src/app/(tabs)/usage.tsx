import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Path as SvgPath, Line as SvgLine } from 'react-native-svg';
import { CalendarPicker, type CalendarSelectionMode } from '@/components/calendar-picker';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { GlassSegmented } from '@/components/glass-segment';
import { PageHeader, PrimaryButton } from '@/components/ui';
import { UsageChart } from '@/components/usage-chart';
import { UsageChartLoader } from '@/components/usage-chart-loader';
import { loadEnergyBreakdown, type EnergyBreakdown } from '@/lib/energy-breakdown-data';
import { getUsageView, type UsageBand, type UsagePeriod, type UsageViewData } from '@/lib/usage-data';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

type Period = UsagePeriod;
type Unit = 'kwh' | 'cost';
type ChartType = 'line' | 'bar';
type ComparisonSelection = { first: string; second: string };

function LineChartIcon({ color }: { color: string }) {
  return (
    <Svg height={18} viewBox="0 0 20 18" width={20}>
      <SvgLine stroke={color} strokeLinecap="round" strokeWidth={1.7} x1="2" x2="2" y1="2" y2="16" />
      <SvgLine stroke={color} strokeLinecap="round" strokeWidth={1.7} x1="2" x2="18" y1="16" y2="16" />
      <SvgPath d="M4 12 L7.5 8.5 L10.5 11 L14 5.5 L17 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
    </Svg>
  );
}

const periodOptions = [
  { value: 'daily' as const, label: 'Day' },
  { value: 'weekly' as const, label: 'Week' },
  { value: 'monthly' as const, label: 'Month' },
];

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

function startOfWeek(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function shortDate(date: Date) {
  return `${date.getDate()} ${monthLabels[date.getMonth()]}`;
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
  if (period === 'monthly') return shiftMonth(selected, -4);
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
  if (key === 'peak') return { icon: 'flame-outline' as const, color: palette.red };
  if (key === 'offPeak') return { icon: 'sunny-outline' as const, color: palette.amber };
  return { icon: 'moon-outline' as const, color: palette.periwinkle };
}

function energyCategoryPresentation(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes('heat')) return { icon: 'flame-outline' as const, color: palette.red };
  if (normalized.includes('always') || normalized.includes('base')) return { icon: 'pulse-outline' as const, color: '#38BDF8' };
  return { icon: 'flash-outline' as const, color: palette.amber };
}

export default function UsageScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { height: screenHeight } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>('weekly');
  const [unit, setUnit] = useState<Unit>('cost');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [comparisons, setComparisons] = useState<Record<Period, ComparisonSelection | null>>({ daily: null, weekly: null, monthly: null });
  const [date, setDate] = useState(() => toDateValue(new Date()));
  const [dateOpen, setDateOpen] = useState(false);
  const [energyBreakdownOpen, setEnergyBreakdownOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<'first' | 'second'>('first');
  const [firstPeriod, setFirstPeriod] = useState(() => toDateValue(new Date()));
  const [secondPeriod, setSecondPeriod] = useState(() => toDateValue(addDays(new Date(), -7)));
  const [data, setData] = useState<UsageViewData | null>(null);
  const [energyBreakdown, setEnergyBreakdown] = useState<EnergyBreakdown | null>(null);
  const [, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [animationRun, setAnimationRun] = useState(0);
  const [chartActive, setChartActive] = useState(false);
  const [graphTranslateX] = useState(() => new Animated.Value(0));
  const [graphOpacity] = useState(() => new Animated.Value(1));
  const [graphScale] = useState(() => new Animated.Value(1));
  const [swipeInProgress, setSwipeInProgress] = useState(false);
  const [listInForeground, setListInForeground] = useState(false);
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const chartBlurOpacity = scrollY.interpolate({ inputRange: [0, 70, 150], outputRange: [0, 0.62, 1], extrapolate: 'clamp' });
  const breakdownListPeekHeight = 62 * 4.6;
  const breakdownListStart = Math.max(0, screenHeight - breakdownListPeekHeight);

  const comparison = comparisons[period];
  const compare = comparison !== null;
  const canShowCost = !data || data.totalCostNzd !== null || data.points.some((point) => point.costNzd !== null);
  const unitOptions: readonly Unit[] = canShowCost ? ['cost', 'kwh'] : ['kwh'];
  const displayUnit: Unit = canShowCost ? unit : 'kwh';
  const chartValues = useMemo(() => {
    if (!data) return [];
    const values = displayUnit === 'cost'
      ? data.points.every((point) => point.costNzd !== null) ? data.points.map((point) => point.costNzd as number) : []
      : data.points.map((point) => point.kwh);
    return values;
  }, [data, displayUnit]);
  const chartPrevious = useMemo(() => {
    if (!data?.comparisonPoints) return undefined;
    const values = displayUnit === 'cost'
      ? data.comparisonPoints.every((point) => point.costNzd !== null) ? data.comparisonPoints.map((point) => point.costNzd as number) : []
      : data.comparisonPoints.map((point) => point.kwh);
    return values;
  }, [data, displayUnit]);
  const suffix = displayUnit === 'cost' ? 'NZD' : 'kWh';
  const chartLabels = useMemo(() => data?.points.map((point) => point.axisLabel) ?? [], [data?.points]);
  // The official API publishes daily meter totals, so the X axis must follow the
  // actual returned dates. Hour labels would imply readings the backend does not send.
  const chartAxisLabels = chartLabels;
  const tooltipLabels = data?.points.map((point) => point.tooltipLabel);
  const previousTooltipLabels = data?.comparisonPoints?.map((point) => point.tooltipLabel);
  const selectedPeriodLabel = comparison ? comparisonSelectionLabel(period, comparison) : selectionLabel(period, date);
  const bands = data?.bands ?? unavailableBands;
  const periodTitle = period === 'daily' ? "Today's total" : period === 'weekly' ? "This week's total" : "This month's total";
  useEffect(() => {
    const controller = new AbortController();
    if (process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'true' || !session?.customerId) {
      void Promise.resolve().then(() => { if (!controller.signal.aborted) setEnergyBreakdown(null); });
      return () => controller.abort();
    }
    void loadEnergyBreakdown(session.customerId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setEnergyBreakdown(result.available ? result : null); })
      .catch(() => { if (!controller.signal.aborted) setEnergyBreakdown(null); });
    return () => controller.abort();
  }, [session?.customerId, reloadToken]);
  const formatAmount = (kwh: number | null, costNzd: number | null) => displayUnit === 'cost' ? costNzd === null ? '—' : `$${costNzd.toFixed(2)}` : kwh === null ? '—' : `${kwh.toFixed(1)} kWh`;
  const totalDisplay = displayUnit === 'cost' ? data?.totalCostNzd == null ? '—' : `$${data.totalCostNzd.toFixed(2)}` : data?.totalKwh == null ? '—' : data.totalKwh.toFixed(1);


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
      try {
        const result = await getUsageView({ customerId: session?.customerId ?? '', period, date, compareDate: comparison?.second, signal: controller.signal });
        if (!controller.signal.aborted) {
          setData(result);
          // Move a date outside the fixture range to available data. Weekly charts
          // deliberately settle on the latest complete Monday-Sunday week, so their
          // X axis is never cut short at the final reading (for example, Friday).
          const needsAvailableRange = period === 'weekly' ? result.points.length < 7 : result.points.length === 0;
          if (!comparison && !result.isDemo && needsAvailableRange && result.availableTo) {
            const latest = parseDate(result.availableTo);
            const fallbackDate = period === 'weekly'
              ? toDateValue(addDays(startOfWeek(latest), -1))
              : result.availableTo;
            if (fallbackDate !== date) setDate(fallbackDate);
          }
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Usage could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [comparison, date, period, reloadToken, session?.customerId]);

  const shiftGraph = useCallback((direction: 'previous' | 'next') => {
    if (swipeInProgress) return;
    if (period === 'weekly' && !comparison && data?.availableFrom && data.availableTo) {
      const targetWeek = weekDates(shiftPeriodDate(period, date, direction === 'previous' ? -1 : 1));
      if (toDateValue(targetWeek[6]!) < data.availableFrom || toDateValue(targetWeek[0]!) > data.availableTo) return;
    }
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
  }, [comparison, data?.availableFrom, data?.availableTo, date, graphOpacity, graphScale, graphTranslateX, period, setAnimationRun, setChartActive, setComparisons, setDate, setSwipeInProgress, swipeInProgress]);

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
    <Screen contentStyle={styles.screenRoot} onTouchStart={() => setChartActive(false)} scroll={false}>
      <View style={styles.screenEnter}>


      {/* Header, controls, and chart */}
      <View
        pointerEvents="box-none"
        style={[styles.fixedBackdrop, { zIndex: listInForeground ? 1 : 20 }]}
      >
        <Animated.View style={styles.chartContainer}>
          <View style={styles.headerControls}>
            <PageHeader
              action={
                <Pressable
                  accessibilityLabel="Refresh usage"
                  onPress={refresh}
                  style={[styles.refresh, { backgroundColor: colors.input }]}
                >
                  {loading ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons color="#FFFFFF" name="refresh" size={20} />}
                </Pressable>
              }
              subtitle="Track your usage"
              title="Usage"
            />

            <GlassSegmented
              appearance="usage"
              onChange={changePeriod}
              options={periodOptions}
              value={period}
            />

            <View style={styles.toolbarRow}>
              <Pressable
                accessibilityLabel={`Choose ${period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}`}
                onPress={compare ? openComparison : () => setDateOpen(true)}
                style={({ pressed }) => [
                  styles.toolbarButton,
                  compare && styles.comparisonDateButton,
                  compare && period === 'weekly' && styles.weekComparisonDateButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons color="#FFFFFF" name="calendar-outline" size={19} />
                <Text numberOfLines={compare && period === 'weekly' ? 3 : 2} style={[styles.toolbarButtonText, { color: colors.text }]}>
                  {selectedPeriodLabel}
                </Text>
                <Ionicons color={colors.textMuted} name="chevron-down" size={14} />
              </Pressable>

              <View
                style={[
                  styles.toolbarButton,
                  styles.compareButton,
                ]}
              >
                <Pressable
                  accessibilityLabel="Choose periods to compare"
                  onPress={openComparison}
                  style={({ pressed }) => [styles.compareMain, pressed && styles.pressed]}
                >
                  <Ionicons color="#FFFFFF" name="git-compare-outline" size={19} />
                  <Text style={[styles.toolbarButtonText, { color: '#FFFFFF' }]}>Compare</Text>
                </Pressable>
                {compare ? (
                  <Pressable accessibilityLabel="Exit comparison mode" hitSlop={5} onPress={clearComparison} style={styles.compareClose}>
                    <Ionicons color="#FFFFFF" name="close" size={18} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          {loading && !data ? (
            <UsageChartLoader />
          ) : (
          <>
          {/* Chart Header & Unit Toggle (Outside of PanResponder for instant, 100% reliable tapping) */}
          <View style={styles.chartHeaderCard}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={[styles.total, { color: colors.text }]}>
                  {totalDisplay} <Text style={styles.suffix}>{suffix}</Text>
                </Text>
              </View>
              <View style={styles.headerToggles}>
                <View style={[styles.unitToggle, { backgroundColor: colors.input }]}>
                  {(['line', 'bar'] as const).map((item) => (
                    <Pressable
                      accessibilityLabel={item === 'line' ? 'Line chart' : 'Bar chart'}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chartType === item }}
                      hitSlop={8}
                      key={item}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setChartType(item);
                      }}
                      style={[styles.unitOption, chartType === item && { backgroundColor: '#FFFFFF' }]}
                    >
                      {item === 'line' ? (
                        <LineChartIcon color={chartType === item ? '#000000' : colors.textMuted} />
                      ) : (
                        <Ionicons color={chartType === item ? '#000000' : colors.textMuted} name="bar-chart-outline" size={16} />
                      )}
                    </Pressable>
                  ))}
                </View>
                <View style={[styles.unitToggle, { backgroundColor: colors.input }]}>
                  {unitOptions.map((item) => (
                    <Pressable
                      hitSlop={8}
                      key={item}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setUnit(item);
                      }}
                      style={[styles.unitOption, displayUnit === item && { backgroundColor: '#FFFFFF' }]}
                    >
                      <Text style={[styles.unitText, { color: displayUnit === item ? '#000000' : colors.textMuted }]}>
                        {item === 'kwh' ? 'kWh' : '$'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

          </View>

          {/* Interactive Graph Area with Swipe PanResponder */}
          <Animated.View
            {...chartPanResponder.panHandlers}
            style={{ opacity: graphOpacity, transform: [{ translateX: graphTranslateX }, { scale: graphScale }] }}
          >
            <View style={styles.fullWidthChartWrap}>
              <UsageChart
                accessibilityLabel={`${period} electricity usage in ${displayUnit === 'cost' ? 'dollars' : 'kilowatt-hours'}`}
                active={chartActive}
                chartType={chartType}
                leadingDecorativeAnchor
                key={`${period}-${displayUnit}-${chartType}-${date}-${compare}-${comparison?.second ?? ''}-${animationRun}`}
                axisLabels={chartAxisLabels}
                labels={chartLabels}
                onActivate={() => setChartActive(true)}
                previous={chartPrevious}
                previousTooltipLabels={previousTooltipLabels}
                tooltipLabels={tooltipLabels}
                unit={displayUnit}
                values={chartValues}
                xLabelInterval={1}
              />
              {compare ? (
                <View style={styles.chartLegend}>
                  <View style={styles.chartLegendItem}>
                    <View style={[styles.chartLegendDot, { backgroundColor: '#C7F071' }]} />
                    <Text style={styles.chartLegendText}>{comparison ? selectionLabel(period, comparison.first) : ''}</Text>
                  </View>
                  <View style={styles.chartLegendItem}>
                    <View style={[styles.chartLegendDot, { backgroundColor: '#FBBF24' }]} />
                    <Text style={styles.chartLegendText}>{comparison ? selectionLabel(period, comparison.second) : ''}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </Animated.View>
          </>
          )}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: chartBlurOpacity }]}>
          <BlurView intensity={46} pointerEvents="none" style={StyleSheet.absoluteFill} tint="dark" />
          <View pointerEvents="none" style={styles.backdropBlurShade} />
        </Animated.View>
      </View>

      <View style={[styles.listViewport, { zIndex: listInForeground ? 30 : 10 }]}>
        <Animated.ScrollView
          contentContainerStyle={styles.listScrollContent}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            {
              listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
                const nextForeground = event.nativeEvent.contentOffset.y > 2;
                setListInForeground((current) => current === nextForeground ? current : nextForeground);
              },
              useNativeDriver: true,
            },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.listScrollView}
        >
          <View pointerEvents="none" style={{ height: breakdownListStart }} />
          <View style={styles.breakdownContent}>
            <View style={styles.breakdownList}>
              {energyBreakdown?.categories.length ? (
                <Pressable accessibilityRole="button" onPress={() => setEnergyBreakdownOpen(true)} style={styles.breakdownRow}>
                  <View style={styles.breakdownIcon}>
                    <Ionicons color={colors.textMuted} name="pie-chart-outline" size={19} />
                  </View>
                  <View style={styles.breakdownCopy}>
                    <Text style={[styles.breakdownTitle, { color: colors.text }]}>Energy breakdown</Text>
                    <Text style={[styles.breakdownDetail, { color: '#A1A1AA' }]}>{energyBreakdown.period || 'Selected period'}</Text>
                  </View>
                  <Ionicons color={colors.textMuted} name="chevron-forward" size={22} />
                </Pressable>
              ) : null}
              <View style={styles.breakdownRow}>
                <View style={styles.breakdownIcon}>
                  <Ionicons color={colors.textMuted} name="pulse-outline" size={19} />
                </View>
                <View style={styles.breakdownCopy}>
                  <Text style={[styles.breakdownTitle, { color: colors.text }]}>{periodTitle}</Text>
                  <Text style={[styles.breakdownDetail, { color: '#A1A1AA' }]}>Current selected period</Text>
                </View>
                <View style={styles.breakdownValueWrap}>
                  <Text style={[styles.breakdownValue, { color: colors.text }]}>
                    {formatAmount(data?.totalKwh ?? null, data?.totalCostNzd ?? null)}
                  </Text>
                  <Text
                    style={{
                      color: (data?.trendPercent ?? 0) <= 0 ? palette.green : palette.red,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {data?.trendPercent == null ? '—' : `${data.trendPercent > 0 ? '+' : ''}${data.trendPercent.toFixed(1)}%`}
                  </Text>
                </View>
              </View>

              {bands.map((band, index) => {
                const presentation = bandPresentation(band.key);
                const share =
                  band.kwh !== null && data?.totalKwh ? `${Math.round((band.kwh / data.totalKwh) * 100)}%` : '—';
                return (
                  <View key={band.key} style={[styles.breakdownRow, index === bands.length - 1 && styles.breakdownRowLast]}>
                    <View style={styles.breakdownIcon}>
                      <Ionicons color={presentation.color} name={presentation.icon} size={21} />
                    </View>
                    <View style={styles.breakdownCopy}>
                      <Text style={[styles.breakdownTitle, { color: colors.text }]}>{band.label}</Text>
                      <Text style={[styles.breakdownDetail, { color: '#A1A1AA' }]}>
                        {band.window ?? 'No time window supplied'}
                      </Text>
                    </View>
                    <View style={styles.breakdownValueWrap}>
                      <Text style={[styles.breakdownValue, { color: colors.text }]}>
                        {formatAmount(band.kwh, band.costNzd)}
                      </Text>
                      <Text style={[styles.breakdownShare, { color: '#A1A1AA' }]}>{share}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

          </View>
        </Animated.ScrollView>
      </View>

      {/* MODALS */}
      <ModalSheet
        footer={<PrimaryButton label="Done" onPress={() => setEnergyBreakdownOpen(false)} />}
        onClose={() => setEnergyBreakdownOpen(false)}
        title="Energy breakdown"
        visible={energyBreakdownOpen}
      >
        <View style={[styles.energyBreakdownHero, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <View style={styles.energyBreakdownHeroIcon}><Ionicons color={palette.violet} name="pie-chart-outline" size={22} /></View>
          <View style={styles.energyBreakdownHeroCopy}><Text style={[styles.energyBreakdownHeroTitle, { color: colors.text }]}>Where your energy went</Text><Text style={[styles.energyBreakdownIntro, { color: colors.textMuted }]}>{energyBreakdown?.period || 'Selected period'}</Text></View>
        </View>
        <View style={styles.energyBreakdownSheet}>
          {energyBreakdown?.categories.map((category) => {
            const presentation = energyCategoryPresentation(category.key);
            const estimated = category.confidence !== 'measured';
            return <View key={category.key} style={[styles.energyCategoryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.energyCategoryIcon, { backgroundColor: `${presentation.color}20` }]}><Ionicons color={presentation.color} name={presentation.icon} size={20} /></View>
              <View style={[styles.energyCategoryCopy, styles.energyCategoryCopyCompact]}>
                <Text style={[styles.energyCategoryTitle, { color: colors.text }]}>{category.label}</Text>
                <View style={[styles.confidenceBadge, { backgroundColor: estimated ? 'rgba(255, 214, 10, 0.14)' : 'rgba(48, 209, 88, 0.14)' }]}><Text style={[styles.confidenceBadgeText, { color: estimated ? palette.amber : palette.green }]}>{estimated ? 'ESTIMATED' : 'MEASURED'}</Text></View>
                <Text style={[styles.breakdownDetail, { color: colors.textMuted }]}>{category.confidence === 'measured' ? category.basis : `Estimated · ${category.basis}`}</Text>
                {category.caveat ? <Text style={[styles.energyCategoryCaveat, { color: colors.textMuted }]}>{category.caveat}</Text> : null}
              </View>
              <View style={styles.breakdownValueWrap}>
                <Text style={[styles.breakdownValue, { color: colors.text }]}>{formatAmount(category.kwh, category.costNzd)}</Text>
                <Text style={[styles.breakdownShare, { color: colors.textMuted }]}>{category.kwh.toFixed(1)} kWh · {Math.round(category.sharePct)}%</Text>
              </View>
            </View>;
          })}
        </View>
      </ModalSheet>
      <ModalSheet
        footer={
          <View style={styles.doneFooter}>
            <View style={styles.doneButton}>
              <PrimaryButton label="Done" onPress={() => setDateOpen(false)} />
            </View>
          </View>
        }
        onClose={() => setDateOpen(false)}
        title={`Choose ${period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}`}
        visible={dateOpen}
      >
        <View style={styles.dateDialog}>
          <Text style={[styles.dialogLabel, { color: colors.textMuted }]}>
            Selected {period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}
          </Text>
          <Text style={[styles.selectedDateText, { color: colors.text }]}>{selectionLabel(period, date)}</Text>
          <CalendarPicker key={`date-${date}`} onChange={setDate} selectionMode={selectionMode} value={date} />
        </View>
      </ModalSheet>

      <ModalSheet
        footer={
          <View style={styles.doneFooter}>
            <View style={styles.doneButton}>
              <PrimaryButton label="Done" onPress={applyComparison} />
            </View>
          </View>
        }
        onClose={() => setCompareOpen(false)}
        title="Compare usage"
        visible={compareOpen}
      >
        <View style={styles.compareDialog}>
          <Text style={[styles.compareHelp, { color: colors.textMuted }]}>
            Choose the two {period === 'daily' ? 'dates' : period === 'weekly' ? 'weeks' : 'months'} you want to compare.
          </Text>
          <View style={styles.periodBoxes}>
            <Pressable
              onPress={() => setCompareTarget('first')}
              style={[
                styles.periodBox,
                { backgroundColor: colors.input, borderColor: compareTarget === 'first' ? '#38BDF8' : colors.border },
              ]}
            >
              <Text style={[styles.periodBoxLabel, { color: colors.textMuted }]}>First</Text>
              <Text numberOfLines={2} style={[styles.periodBoxValue, { color: colors.text }]}>
                {selectionLabel(period, firstPeriod)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setCompareTarget('second')}
              style={[
                styles.periodBox,
                { backgroundColor: colors.input, borderColor: compareTarget === 'second' ? '#38BDF8' : colors.border },
              ]}
            >
              <Text style={[styles.periodBoxLabel, { color: colors.textMuted }]}>Second</Text>
              <Text numberOfLines={2} style={[styles.periodBoxValue, { color: colors.text }]}>
                {selectionLabel(period, secondPeriod)}
              </Text>
            </Pressable>
          </View>
          <CalendarPicker
            key={`${compareTarget}-${compareTarget === 'first' ? firstPeriod : secondPeriod}`}
            onChange={compareTarget === 'first' ? setFirstPeriod : setSecondPeriod}
            selectionMode={selectionMode}
            value={compareTarget === 'first' ? firstPeriod : secondPeriod}
          />
        </View>
      </ModalSheet>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenEnter: { flex: 1 },
  screenRoot: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    position: 'relative',
    backgroundColor: '#000000',
  },
  ambientGlowContainer: {
    position: 'absolute',
    top: 520,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  fixedBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    backgroundColor: '#000000',
  },
  backdropBlurShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  headerControls: {
    paddingHorizontal: 18,
  },
  chartContainer: {
    width: '100%',
  },
  refresh: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  toolbarRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  toolbarButton: {
    backgroundColor: '#111512',
    borderWidth: 1,
    borderColor: '#202822',
    minWidth: 0,
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    overflow: 'hidden',
    borderRadius: 999,
  },
  comparisonDateButton: {
    gap: 3,
    paddingHorizontal: 4,
  },
  weekComparisonDateButton: {
    minHeight: 56,
  },
  toolbarButtonText: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  compareButton: {
    backgroundColor: '#111512',
    gap: 0,
    overflow: 'hidden',
    paddingHorizontal: 0,
  },
  compareMain: {
    minWidth: 0,
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 9,
  },
  compareClose: {
    width: 38,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(56,189,248,0.32)',
  },
  pressed: {
    opacity: 0.7,
  },
  chartHeaderCard: {
    marginTop: 36,
    paddingBottom: 4,
    zIndex: 10,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 18,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  total: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -1.1,
  },
  suffix: {
    fontSize: 9,
    color: '#FFFFFF',
  },
  swipeHint: {
    minHeight: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: -4,
    marginBottom: 2,
    borderRadius: 12,
    paddingHorizontal: 9,
  },
  swipeHintText: {
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '800',
  },
  unitToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
  },
  headerToggles: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unitOption: {
    width: 38,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  unitText: {
    fontSize: 11,
    fontWeight: '900',
  },
  fullWidthChartWrap: {
    alignSelf: 'stretch',
    position: 'relative',
    width: '100%',
    marginTop: 8,
    marginHorizontal: 0,
    paddingHorizontal: 0,
    paddingTop: 18,
    paddingBottom: 8,
  },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    paddingTop: 4,
    paddingBottom: 4,
  },
  chartLegendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  chartLegendDot: {
    borderRadius: 2,
    height: 10,
    width: 10,
  },
  chartLegendText: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '800',
  },
  listViewport: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  listScrollView: {
    flex: 1,
  },
  listScrollContent: {
    paddingBottom: 20,
  },
  breakdownContent: {
    paddingHorizontal: 0,
    paddingBottom: 12,
  },
  breakdownList: {
    marginTop: 22,
    marginHorizontal: 8,
  },
  breakdownRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  breakdownRowLast: {
    borderBottomWidth: 0,
  },
  energyBreakdownHero: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 13 },
  energyBreakdownHeroIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(168, 85, 247, 0.16)' },
  energyBreakdownHeroCopy: { flex: 1 },
  energyBreakdownHeroTitle: { fontSize: 15, fontWeight: '900' },
  energyBreakdownIntro: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  energyBreakdownSheet: { gap: 10, marginTop: 14 },
  energyCategoryCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 17, padding: 12 },
  energyCategoryIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  energyCategoryCopy: { flex: 1, minWidth: 0 },
  energyCategoryCopyCompact: { height: 34, overflow: 'hidden' },
  energyCategoryTitle: { fontSize: 13, fontWeight: '800' },
  energyCategoryCaveat: { marginTop: 4, fontSize: 10, lineHeight: 14 },
  confidenceBadge: { alignSelf: 'flex-start', marginTop: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  confidenceBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.35 },
  breakdownIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'transparent',
  },
  breakdownCopy: {
    minWidth: 0,
    flex: 1,
    marginLeft: -10,
  },
  breakdownTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  breakdownDetail: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 18,
  },
  breakdownValueWrap: {
    alignItems: 'flex-end',
    gap: 3,
  },
  breakdownValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  breakdownShare: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateDialog: {
    gap: 10,
  },
  dialogLabel: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  selectedDateText: {
    marginBottom: 2,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  doneFooter: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  doneButton: {
    width: 132,
  },
  compareDialog: {
    gap: 13,
  },
  compareHelp: {
    fontSize: 12,
    lineHeight: 18,
  },
  periodBoxes: {
    flexDirection: 'row',
    gap: 6,
  },
  periodBox: {
    minWidth: 0,
    minHeight: 70,
    flex: 1,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  periodBoxLabel: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  periodBoxValue: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
});
