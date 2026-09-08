import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, IconButton, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { UsageChart } from '@/components/usage-chart';
import { dashboardNews, dashboardNotifications, getDashboardView, type DashboardNewsItem, type DashboardViewData } from '@/lib/dashboard-data';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

type ChartUnit = 'kwh' | 'cost';
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const todayChartLabels = ['12', '', '', '3', '', '', '6', '', '', '9', '', '', '12', '', '', '3', '', '', '6', '', '', '9', '', '', '12'];
const todayTimeBands = [{ label: 'AM', startIndex: 0, endIndex: 12 }, { label: 'PM', startIndex: 12, endIndex: 24 }] as const;

export default function DashboardScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const router = useRouter();
  const [selectedNews, setSelectedNews] = useState<DashboardNewsItem | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [billShockOpen, setBillShockOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState(() => dashboardNotifications.map((item) => ({ ...item })));
  const [todayUnit, setTodayUnit] = useState<ChartUnit>('cost');
  const [weekUnit, setWeekUnit] = useState<ChartUnit>('cost');
  const [activeChart, setActiveChart] = useState<'today' | 'week' | null>(null);
  const [animationRun, setAnimationRun] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardViewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const firstName = session?.displayName.split(' ')[0] ?? 'there';
  const unreadCount = notificationItems.filter((item) => item.unread).length;
  const warningState = loadError ? null : dashboard?.warningTriggered ?? null;
  const warningTone = warningState === true ? '#E76C7B' : warningState === false ? '#46B98A' : colors.textMuted;
  const warningToneBackground = warningState === true ? '#FFECEF' : warningState === false ? '#E7F8F1' : colors.input;
  const weeklyKwh = dashboard?.weeklyValuesKwh.reduce((sum, value) => sum + value, 0) ?? null;
  const money = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(2)}`;
  const energy = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)} kWh`;
  const metrics = [
    { label: 'Latest day cost', value: money(dashboard?.latestDayCostNzd), icon: 'cash-outline' as const, tone: '#F1EDFF' },
    { label: 'Usage this week', value: energy(weeklyKwh), icon: 'flash-outline' as const, tone: '#FFF4D9' },
    { label: 'Cost so far', value: money(dashboard?.costSoFarNzd), icon: 'wallet-outline' as const, tone: '#E6F8F1' },
    { label: 'Projected cycle', value: money(dashboard?.projectedCycleCostNzd), icon: 'trending-up-outline' as const, tone: '#FFECEF' },
  ];

  const markAllRead = () => setNotificationItems((items) => items.map((item) => ({ ...item, unread: false })));
  const todayValues = dashboard?.todayValuesKwh.length ? [...dashboard.todayValuesKwh, dashboard.todayValuesKwh[0] ?? 0] : [];
  const todayRate = dashboard?.todayKwh && dashboard.latestDayCostNzd != null ? dashboard.latestDayCostNzd / dashboard.todayKwh : null;
  const weeklyRate = weeklyKwh && dashboard?.weeklyCostNzd != null ? dashboard.weeklyCostNzd / weeklyKwh : null;

  useEffect(() => {
    const controller = new AbortController();
    getDashboardView(session?.customerId ?? '', controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setDashboard(result); setLoadError(null); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Dashboard data could not be loaded.'); });
    return () => controller.abort();
  }, [session?.customerId]);

  useFocusEffect(useCallback(() => {
    setAnimationRun((run) => run + 1);
  }, []));

  return (
    <Screen onTouchStart={() => setActiveChart(null)}>
      <PageHeader title={`Kia ora, ${firstName}`} subtitle="Here is your energy snapshot" action={<View style={styles.notificationButton}><IconButton icon="notifications-outline" label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onPress={() => setNotificationsOpen(true)} />{unreadCount ? <View pointerEvents="none" style={styles.notificationCount}><Text style={styles.notificationCountText}>{unreadCount}</Text></View> : null}</View>} />

      <Pressable accessibilityHint="Opens warning details" accessibilityRole="button" disabled={!dashboard?.warningTriggered || Boolean(loadError)} onPress={() => setBillShockOpen(true)} style={styles.alertCardWrap}>
        {({ pressed }) => <><Card style={[styles.alertCard, pressed && styles.pressed]}>
            <View style={styles.alertIcon}><View style={[styles.alertIconOuter, { borderColor: warningTone }]}><View style={[styles.alertIconSoftRing, { backgroundColor: warningToneBackground }]}><View style={[styles.alertIconCenter, { backgroundColor: warningTone }]}><Ionicons color="#FFFFFF" name={warningState === false ? 'checkmark' : 'flash'} size={19} /></View></View></View></View>
            <View style={styles.alertCopy}><Text style={[styles.alertTitle, { color: colors.text }]}>{loadError ? 'Usage data unavailable' : dashboard?.warningTriggered === false ? 'No high bill warning' : dashboard?.warningTriggered ? 'High bill warning' : 'Checking your usage'}</Text><Text style={[styles.alertBody, { color: colors.textMuted }]}>{loadError ?? (dashboard?.warningTriggered === false ? 'Your projected bill is currently in line with comparable homes.' : dashboard?.warningTriggered ? 'Your projected bill is trending above comparable homes.' : 'Your latest energy snapshot is loading.')}</Text></View>
            <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
          </Card><AlertCardBorder warning={warningState} /></>}
      </Pressable>

      <View style={styles.metricGrid}>
        {metrics.map((metric) => (
          <Card key={metric.label} style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: metric.tone }]}><Ionicons color={palette.violet} name={metric.icon} size={19} /></View>
            <View style={styles.metricCopy}>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{metric.label}</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{metric.value}</Text>
            </View>
          </Card>
        ))}
      </View>

      <SectionTitle>Today</SectionTitle>
      <Card>
        <View style={styles.chartHeader}><View><Text style={[styles.chartValue, { color: colors.text }]}>{todayUnit === 'cost' ? money(dashboard?.latestDayCostNzd) : energy(dashboard?.todayKwh)}</Text><Text style={[styles.chartMeta, { color: colors.textMuted }]}>Today so far</Text></View><ChartUnitToggle colors={colors} onChange={setTodayUnit} value={todayUnit} /></View>
        <UsageChart accessibilityLabel={`Hourly electricity usage for today in ${todayUnit === 'cost' ? 'dollars' : 'kilowatt-hours'}`} active={activeChart === 'today'} key={`today-${animationRun}-${todayUnit}`} labels={todayChartLabels} onActivate={() => setActiveChart('today')} onDismiss={() => setActiveChart(null)} timeBands={todayTimeBands} tooltipLabels={dashboard?.todayTooltipLabels.length ? [...dashboard.todayTooltipLabels, '12am'] : []} unit={todayUnit} values={todayUnit === 'cost' ? todayRate === null ? [] : todayValues.map((value) => value * todayRate) : todayValues} />
      </Card>

      <SectionTitle>Last 7 days</SectionTitle>
      <Card>
        <View style={styles.chartHeader}><View><Text style={[styles.chartValue, { color: colors.text }]}>{weekUnit === 'cost' ? money(dashboard?.weeklyCostNzd) : energy(weeklyKwh)}</Text><Text style={[styles.chartMeta, { color: colors.textMuted }]}>{dashboard?.weeklyValuesKwh.length ? 'Calculated from current account data' : 'Waiting for backend usage data'}</Text></View><View style={styles.chartActions}><ChartUnitToggle colors={colors} onChange={setWeekUnit} value={weekUnit} /><View style={styles.downBadge}><Ionicons color={palette.green} name={(dashboard?.trendPercent ?? 0) > 0 ? 'trending-up' : 'trending-down'} size={14} /><Text style={styles.downText}>{dashboard?.trendPercent == null ? '—' : `${Math.abs(dashboard.trendPercent).toFixed(1)}%`}</Text></View></View></View>
        <UsageChart accessibilityLabel={`Electricity usage over the last seven days in ${weekUnit === 'cost' ? 'dollars' : 'kilowatt-hours'}`} active={activeChart === 'week'} key={`week-${animationRun}-${weekUnit}`} labels={dashboard?.weeklyLabels ?? []} onActivate={() => setActiveChart('week')} onDismiss={() => setActiveChart(null)} secondaryLabels={dashboard?.weeklyDayLabels} tertiaryLabels={dashboard?.weeklyMonthLabels} unit={weekUnit} values={weekUnit === 'cost' ? weeklyRate === null ? [] : (dashboard?.weeklyValuesKwh ?? []).map((value) => value * weeklyRate) : dashboard?.weeklyValuesKwh ?? []} />
      </Card>

      <SectionTitle>News and support</SectionTitle>
      <ScrollView horizontal contentContainerStyle={styles.newsRow} showsHorizontalScrollIndicator={false}>
        {dashboardNews.map((item) => (
          <Pressable key={item.id} onPress={() => setSelectedNews(item)} style={({ pressed }) => [styles.newsCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
            <Image contentFit="cover" source={item.image} style={styles.newsImage} />
            <View style={styles.newsCopy}><Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text><Text style={[styles.newsSummary, { color: colors.textMuted }]} numberOfLines={2}>{item.summary}</Text><Text style={styles.newsDate}>{item.date}</Text></View>
          </Pressable>
        ))}
      </ScrollView>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setSelectedNews(null)} />} onClose={() => setSelectedNews(null)} title={selectedNews?.title ?? 'News'} visible={Boolean(selectedNews)}>
        {selectedNews ? <><Image contentFit="cover" source={selectedNews.image} style={styles.modalImage} /><Text style={[styles.modalDate, { color: palette.violet }]}>{selectedNews.date}</Text><Text style={[styles.modalBody, { color: colors.textMuted }]}>{selectedNews.body}</Text></> : null}
      </ModalSheet>
      <ModalSheet footer={<PrimaryButton icon="sparkles-outline" label="Ask Sparky AI" onPress={() => { setBillShockOpen(false); router.push('/assistant'); }} />} onClose={() => setBillShockOpen(false)} title="High bill warning" visible={billShockOpen}>
        <View style={styles.shockModal}>
          <BillShockAnimation active={billShockOpen} />
          <Text style={[styles.shockTitle, { color: colors.text }]}>Your projected bill is trending high</Text>
          <Text style={[styles.shockBody, { color: colors.textMuted }]}>Ask Sparky to understand what may be contributing and what you can do next.</Text>
          <View style={styles.shockNote}><Ionicons color="#D95668" name="information-circle-outline" size={18} /><Text style={[styles.shockNoteText, { color: colors.textMuted }]}>This warning is based on your latest bill-shock data.</Text></View>
        </View>
      </ModalSheet>
      <ModalSheet footer={<PrimaryButton icon={unreadCount ? 'checkmark-done-outline' : undefined} label={unreadCount ? 'Mark all read' : 'Done'} onPress={unreadCount ? markAllRead : () => setNotificationsOpen(false)} />} onClose={() => setNotificationsOpen(false)} title="Notifications" visible={notificationsOpen}>
        <Text style={[styles.notificationIntro, { color: colors.textMuted }]}>{unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up'}</Text>
        <View style={styles.notificationList}>{notificationItems.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => setNotificationItems((items) => items.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry))} style={({ pressed }) => [styles.notificationRow, { backgroundColor: item.unread ? colors.input : colors.surface, borderColor: item.unread ? palette.periwinkle : colors.border }, pressed && styles.pressed]}><View style={[styles.notificationIcon, { backgroundColor: item.unread ? '#F0EDFF' : colors.input }]}><Ionicons color={item.unread ? palette.violet : colors.textMuted} name={item.icon} size={20} /></View><View style={styles.notificationCopy}><View style={styles.notificationTitleRow}><Text style={[styles.notificationTitle, { color: colors.text }]}>{item.title}</Text>{item.unread ? <View style={styles.unreadDot} /> : null}</View><Text style={[styles.notificationDetail, { color: colors.textMuted }]}>{item.detail}</Text><Text style={styles.notificationTime}>{item.time}</Text></View></Pressable>)}</View>
      </ModalSheet>
    </Screen>
  );
}

function AlertCardBorder({ warning }: { warning: boolean | null }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (warning === null) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 5000, easing: Easing.inOut(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [progress, warning]);

  if (warning === null) return null;
  const color = warning ? '#E76C7B' : '#46B98A';
  const radius = 20;
  const perimeter = Math.max(1, 2 * Math.max(0, size.width - 2 * radius) + 2 * Math.max(0, size.height - 2 * radius) + 2 * Math.PI * radius);
  const stages = [0.58, 0.72, 0.86, 1];
  const dashOffset = progress.interpolate({ inputRange: [0, 0.58, 1], outputRange: [perimeter, 0, 0] });
  const drawnBorderOpacity = progress.interpolate({ inputRange: [0, 0.57, 0.59, 1], outputRange: [1, 1, 0, 0] });
  const contractingOpacity = progress.interpolate({ inputRange: [0, 0.57, 0.59, 1], outputRange: [0, 0, 1, 1] });
  const outlineX = progress.interpolate({ inputRange: stages, outputRange: [2, 7, 11, 15] });
  const outlineY = progress.interpolate({ inputRange: stages, outputRange: [2, 7, 12, Math.max(2, (size.height - 46) / 2)] });
  const outlineWidth = progress.interpolate({ inputRange: stages, outputRange: [size.width - 4, size.width - 14, Math.max(90, size.width * 0.48), 46] });
  const outlineHeight = progress.interpolate({ inputRange: stages, outputRange: [size.height - 4, size.height - 14, Math.max(50, size.height - 24), 46] });
  const outlineRadius = progress.interpolate({ inputRange: stages, outputRange: [radius, 18, 25, 23] });
  const right = size.width - 2;
  const bottom = size.height - 2;
  const topLeftStartPath = `M ${radius + 2} 2 H ${right - radius} A ${radius} ${radius} 0 0 1 ${right} ${radius + 2} V ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} H ${radius + 2} A ${radius} ${radius} 0 0 1 2 ${bottom - radius} V ${radius + 2} A ${radius} ${radius} 0 0 1 ${radius + 2} 2`;

  return <View onLayout={(event) => setSize(event.nativeEvent.layout)} pointerEvents="none" style={StyleSheet.absoluteFill}>
    {size.width > 0 && size.height > 0 ? <Svg height={size.height} width={size.width}>
      <Rect fill="none" height={size.height - 4} rx={radius} ry={radius} stroke="#FFFFFF" strokeOpacity={0.72} strokeWidth={3} width={size.width - 4} x={2} y={2} />
      <AnimatedPath d={topLeftStartPath} fill="none" opacity={drawnBorderOpacity} stroke={color} strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={dashOffset} strokeLinecap="round" strokeWidth={2} />
      <AnimatedRect fill="none" height={outlineHeight} opacity={contractingOpacity} rx={outlineRadius} ry={outlineRadius} stroke={color} strokeLinecap="round" strokeWidth={2} width={outlineWidth} x={outlineX} y={outlineY} />
    </Svg> : null}
  </View>;
}

function BillShockAnimation({ active }: { active: boolean }) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 4000,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, progress]);

  const outerScale = progress.interpolate({ inputRange: [0, 0.42, 0.76, 1], outputRange: [1, 1.14, 0.78, 0.72] });
  const outerRotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '540deg'] });
  const middleScale = progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.3, 0.3, 1] });
  const middleOpacity = progress.interpolate({ inputRange: [0, 0.52, 0.76, 1], outputRange: [0, 0, 0.8, 1] });
  const centerScale = progress.interpolate({ inputRange: [0, 0.68, 0.88, 1], outputRange: [0.1, 0.1, 1.18, 1] });
  const centerOpacity = progress.interpolate({ inputRange: [0, 0.65, 0.82, 1], outputRange: [0, 0, 1, 1] });

  return <View accessibilityLabel="Animated high bill warning" style={styles.shockAnimation}>
    <Animated.View style={[styles.shockOuterRing, { transform: [{ rotate: outerRotate }, { scale: outerScale }] }]}><View style={styles.shockOrbitGap} /></Animated.View>
    <Animated.View style={[styles.shockMiddleRing, { opacity: middleOpacity, transform: [{ scale: middleScale }] }]} />
    <Animated.View style={[styles.shockCenter, { opacity: centerOpacity, transform: [{ scale: centerScale }] }]}><Ionicons color="#FFFFFF" name="flash" size={31} /></Animated.View>
  </View>;
}

function ChartUnitToggle({ colors, value, onChange }: { colors: ReturnType<typeof useAppTheme>['colors']; value: ChartUnit; onChange: (value: ChartUnit) => void }) {
  return <View style={[styles.unitToggle, { backgroundColor: colors.input }]}>{(['kwh', 'cost'] as const).map((item) => <Pressable accessibilityRole="button" key={item} onPress={() => onChange(item)} style={[styles.unitOption, value === item && { backgroundColor: palette.violet }]}><Text style={[styles.unitText, { color: value === item ? '#FFFFFF' : colors.textMuted }]}>{item === 'kwh' ? 'kWh' : '$'}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  alertCardWrap: { position: 'relative', zIndex: 1, borderRadius: 20 },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  notificationButton: { position: 'relative' }, notificationCount: { position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 10, backgroundColor: palette.red, paddingHorizontal: 4 }, notificationCountText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  alertIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  alertIconOuter: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#FFFFFF' },
  alertIconSoftRing: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  alertIconCenter: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  alertCopy: { flex: 1 }, alertTitle: { fontSize: 15, fontWeight: '900' }, alertBody: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  shockModal: { alignItems: 'center', paddingTop: 8 },
  shockAnimation: { width: 176, height: 176, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  shockOuterRing: { position: 'absolute', width: 156, height: 156, borderWidth: 8, borderColor: '#F28B98', borderRadius: 78 },
  shockOrbitGap: { position: 'absolute', top: -10, left: 48, width: 42, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
  shockMiddleRing: { position: 'absolute', width: 106, height: 106, borderWidth: 12, borderColor: '#FFFFFF', borderRadius: 53, backgroundColor: '#F8B8C0', shadowColor: '#D95668', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 5 },
  shockCenter: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: '#E76C7B' },
  shockTitle: { marginTop: 6, fontSize: 20, lineHeight: 26, fontWeight: '900', textAlign: 'center' },
  shockBody: { maxWidth: 440, marginTop: 9, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  shockNote: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, padding: 13, borderWidth: 1, borderColor: '#F6CDD2', borderRadius: 14, backgroundColor: '#FFF5F6' },
  shockNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  metricCard: { width: '48.5%', minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  metricIcon: { width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  metricCopy: { flex: 1, minWidth: 0 },
  metricLabel: { fontSize: 10, lineHeight: 13, fontWeight: '700' }, metricValue: { marginTop: 1, fontSize: 17, lineHeight: 20, fontWeight: '900' },
  chartHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }, chartValue: { fontSize: 23, fontWeight: '900' }, chartMeta: { marginTop: 3, fontSize: 11 },
  chartActions: { alignItems: 'flex-end', gap: 7 }, unitToggle: { flexDirection: 'row', padding: 3, borderRadius: 12 }, unitOption: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, unitText: { fontSize: 12, fontWeight: '900' },
  downBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, backgroundColor: '#E7F8F1', paddingHorizontal: 8, paddingVertical: 5 }, downText: { color: palette.green, fontSize: 11, fontWeight: '900' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  newsRow: { gap: 12, paddingRight: 18 }, newsCard: { width: 232, overflow: 'hidden', borderWidth: 1, borderRadius: 20 }, newsImage: { width: '100%', height: 112 }, newsCopy: { padding: 13 }, newsTitle: { fontSize: 14, lineHeight: 19, fontWeight: '900' }, newsSummary: { marginTop: 5, fontSize: 11, lineHeight: 16 }, newsDate: { marginTop: 9, color: palette.violet, fontSize: 10, fontWeight: '800' },
  modalImage: { width: '100%', height: 190, borderRadius: 18, marginBottom: 14 }, modalDate: { fontSize: 12, fontWeight: '900' }, modalBody: { marginTop: 8, fontSize: 15, lineHeight: 23 },
  notificationIntro: { marginBottom: 12, fontSize: 12, fontWeight: '700' }, notificationList: { gap: 9 }, notificationRow: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 17, padding: 13 }, notificationIcon: { width: 42, height: 42, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, notificationCopy: { flex: 1 }, notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notificationTitle: { flex: 1, fontSize: 13, fontWeight: '900' }, unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.violet }, notificationDetail: { marginTop: 4, fontSize: 11, lineHeight: 16 }, notificationTime: { marginTop: 6, color: palette.violet, fontSize: 9, fontWeight: '800' },
});
