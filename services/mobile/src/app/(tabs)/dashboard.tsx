import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { DemoHomeView } from '@/components/demo-home-view';
import { BottomNavigation } from '@/components/bottom-navigation';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import SemiCircleGauge from '@/components/SemiCircleGauge';
import { BillRingGauge, type BillRingTone } from '@/components/bill-ring-gauge';
import { PrimaryButton } from '@/components/ui';
import { getDashboardView, type DashboardViewData } from '@/lib/dashboard-data';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

export default function DashboardScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();

  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [billShockOpen, setBillShockOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [offGridOpen, setOffGridOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardViewData | null>(null);
  const [ringTone, setRingTone] = useState<BillRingTone>('green');
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fixedContentHeight, setFixedContentHeight] = useState(screenHeight);
  const [listInForeground, setListInForeground] = useState(false);
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const backgroundShift = Math.max(0, fixedContentHeight - screenHeight + 120);
  const backgroundTranslateY = scrollY.interpolate({ inputRange: [0, Math.max(1, backgroundShift)], outputRange: [0, -backgroundShift], extrapolate: 'clamp' });
  const backgroundBlurOpacity = scrollY.interpolate({ inputRange: [Math.max(0, backgroundShift - 90), backgroundShift + 30], outputRange: [0, 1], extrapolate: 'clamp' });
  const gaugePercentage = Math.min(Math.max(dashboard?.overshootPct ?? 0, 0), 100);
  const billShockTone: BillRingTone = dashboard?.warningTriggered ? 'red' : 'green';
  const animatedBillShockColor = ringTone === 'red' ? '#EF4444' : ringTone === 'orange' ? '#FB923C' : '#22C55E';

  const money = (value: number | null | undefined) => (value == null ? '—' : `$${value.toFixed(2)}`);
  const syncListForeground = (offsetY: number) => {
    const nextForeground = offsetY > 2;
    setListInForeground((current) => current === nextForeground ? current : nextForeground);
  };
  const outlookTitle = dashboard?.warningTriggered
    ? dashboard.expectationBasis === 'comparable_homes'
      ? 'Your projected bill is higher than comparable homes'
      : 'Your projected bill is higher than usual'
    : 'Bill prediction';
  const insightTitle = dashboard?.warningTriggered ? 'Currently tracking for bill shock' : 'Below bill-shock alert threshold';
  const dashboardNotifications = dashboard?.warningTriggered
    ? [{ id: 'bill-shock', title: 'Bill prediction warning', detail: dashboard.warningReasons[0] ?? 'Your projected bill is above the expected amount.', unread: true }]
    : [];

  useEffect(() => {
    const controller = new AbortController();
    getDashboardView(session?.customerId ?? '', controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setDashboard(result);
          setDashboardError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDashboardError(error instanceof Error ? error.message : 'Dashboard data could not be loaded.');
      });
    return () => controller.abort();
  }, [reloadKey, session?.customerId]);

  return (
    <Screen contentStyle={styles.screenContent} scroll={false}>
      <Animated.View
        onLayout={(event) => setFixedContentHeight(event.nativeEvent.layout.height)}
        pointerEvents="box-none"
        style={[styles.fixedBackdrop, { zIndex: listInForeground ? 1 : 20, transform: [{ translateY: backgroundTranslateY }] }]}
      >
        <DemoHomeView customerId={session?.customerId ?? null}
          onOpenInfo={() => setWelcomeOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onOpenProfile={() => router.push('/profile')}
        />

        {/* Metrics */}
        {false ? <View style={styles.menuList}>
          <View style={styles.menuRow}>
            <View style={styles.menuCopy}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Latest day’s cost</Text>
              <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>{money(dashboard?.latestDayCostNzd)}</Text>
            </View>
          </View>
          <View style={styles.menuRow}>
            <View style={styles.menuCopy}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Usage so far</Text>
              <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>
                {/* @ts-expect-error Legacy list remains disabled while the card layout is active. */}
                {dashboard?.usageSoFarKwh == null ? '—' : `${dashboard.usageSoFarKwh.toFixed(1)} kWh`}
              </Text>
            </View>
          </View>
          <View style={styles.menuRow}>
            <View style={styles.menuCopy}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Cost so far</Text>
              <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>{money(dashboard?.costSoFarNzd)}</Text>
            </View>
          </View>
          <View style={styles.menuRow}>
            <View style={styles.menuCopy}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Projected this cycle</Text>
              <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>{money(dashboard?.projectedCycleCostNzd)}</Text>
            </View>
          </View>
        </View> : null}

        <View style={styles.cardArea}>
          {dashboard ? <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>{dashboard.sourceLabel}</Text> : null}
          {dashboardError ? <Pressable accessibilityRole="button" onPress={() => { setDashboardError(null); setReloadKey((key) => key + 1); }} style={[styles.dataError, { borderColor: palette.red }]}><Ionicons color={palette.red} name="warning-outline" size={18} /><Text style={[styles.dataErrorText, { color: colors.text }]}>{dashboardError} Tap to retry.</Text></Pressable> : null}
          {false ? <>
          <Pressable accessibilityLabel="Open bill shock warning" onPress={() => setBillShockOpen(true)} style={({ pressed }) => [styles.billShockCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
            <View style={styles.billShockHeader}>
              <View style={styles.warningIdentity}>
                <View style={[styles.cardIcon, { backgroundColor: dashboard?.warningTriggered ? 'rgba(255, 69, 58, 0.16)' : colors.input }]}><Ionicons color={dashboard?.warningTriggered ? palette.red : colors.text} name="alert-circle-outline" size={22} /></View>
                <Text style={[styles.featuredEyebrow, { color: dashboard?.warningTriggered ? palette.red : colors.textMuted }]}>{dashboard?.warningTriggered ? 'BILL SHOCK WARNING' : 'BILL OUTLOOK'}</Text>
              </View>
              <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
            </View>
            <Text style={[styles.featuredTitle, { color: colors.text }]}>{outlookTitle}</Text>
            <Text style={[styles.featuredCaption, { color: colors.textMuted }]}>Tap to view your bill outlook</Text>
            <SemiCircleGauge percentage={gaugePercentage} projectedCost={money(dashboard?.projectedCycleCostNzd)} />
          </Pressable>
          <View style={styles.metricGrid}>
            <MetricCard color={palette.solar} icon="calendar-outline" label="Latest day cost" value={money(dashboard?.latestDayCostNzd)} />
            <MetricCard color={palette.home} icon="flash-outline" label="Usage so far" value={dashboard?.usageSoFarKwh == null ? '—' : `${dashboard?.usageSoFarKwh?.toFixed(1)} kWh`} />
            <MetricCard color={palette.amber} icon="wallet-outline" label="Cost so far" value={money(dashboard?.costSoFarNzd)} />
            <MetricCard color={palette.violet} icon="thermometer-outline" label="Temperature now" value={'— °C'} />
          </View>
          </> : null}
        </View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.blurLayer, { opacity: listInForeground ? backgroundBlurOpacity : 0 }]}>
        <BlurView intensity={46} pointerEvents="none" style={StyleSheet.absoluteFill} tint="dark" />
        <View pointerEvents="none" style={styles.blurShade} />
      </Animated.View>

      <View style={[styles.listViewport, { zIndex: listInForeground ? 30 : 10 }]}>
        <Animated.ScrollView
          contentContainerStyle={styles.homeListScrollContent}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            {
              listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
                syncListForeground(event.nativeEvent.contentOffset.y);
              },
              useNativeDriver: true,
            },
          )}
          onScrollEndDrag={(event) => syncListForeground(event.nativeEvent.contentOffset.y)}
          onMomentumScrollEnd={(event) => syncListForeground(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.listScrollView}
        >
          <View pointerEvents="none" style={{ height: fixedContentHeight }} />
          <BottomNavigation
            billPrediction={{
              detail: dashboard?.warningTriggered ? 'Currently tracking for bill shock' : dashboard?.warningTriggered === false ? 'Below bill-shock alert threshold' : 'View your bill prediction',
              onPress: () => setBillShockOpen(true),
              status: dashboard?.warningTriggered === true ? 'warning' : dashboard?.warningTriggered === false ? 'normal' : undefined,
            }}
            includeHome={false}
            listMode
          />
        </Animated.ScrollView>
      </View>

      {/* --- MODAL SHEET 1: Welcome to the Demo Home (Screenshot 2 exact match) --- */}
      <ModalSheet
        footer={<PrimaryButton label="Done" onPress={() => setNotificationsOpen(false)} />}
        onClose={() => setNotificationsOpen(false)}
        title="Notifications"
        visible={notificationsOpen}
      >
        <Text style={[styles.notificationIntro, { color: colors.textMuted }]}>Recent account updates</Text>
        <View style={styles.notificationList}>
          {dashboardNotifications.map((notification) => (
            <Pressable
              key={notification.id}
              onPress={() => {
                setNotificationsOpen(false);
                if (notification.id === 'bill-shock') setBillShockOpen(true);
                if (notification.id === 'plan-tip') router.push('/plans');
              }}
              style={[styles.notificationRow, { borderBottomColor: colors.border }]}
            >
              <View style={styles.notificationCopy}>
                <View style={styles.notificationTitleRow}>
                  <Text style={[styles.notificationTitle, { color: colors.text }]}>{notification.title}</Text>
                  {notification.unread ? <View style={styles.unreadDot} /> : null}
                </View>
                <Text style={[styles.notificationDetail, { color: colors.textMuted }]}>{notification.detail}</Text>
              </View>
              <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      </ModalSheet>

      <ModalSheet
        footer={<PrimaryButton label="Get Started" onPress={() => setWelcomeOpen(false)} />}
        onClose={() => setWelcomeOpen(false)}
        title="Explore your Kea home"
        visible={welcomeOpen}
      >
        <View style={styles.welcomeModal}>
          <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
            This scene uses current modelled Auckland weather to illustrate how solar, the Kea battery, your home, and an electric car might share power. Energy values are examples, not readings from your home.
          </Text>

          <View style={styles.welcomeFeatures}>
            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(255, 214, 10, 0.16)' }]}>
                <Ionicons color={palette.solar} name="sunny" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>Generate energy during the day</Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(48, 209, 88, 0.16)' }]}>
                <Ionicons color={palette.battery} name="battery-charging" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>
                Store excess energy in the Kea battery for use after dark
              </Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(10, 132, 255, 0.16)' }]}>
                <Ionicons color={palette.violet} name="car-sport" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>
                Charge electric vehicles with clean energy you generate
              </Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(255, 255, 255, 0.14)' }]}>
                <Ionicons color="#FFFFFF" name="flash" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>Reduce grid usage and save money</Text>
            </View>
          </View>
        </View>
      </ModalSheet>

      {/* --- MODAL SHEET 2: Impact --- */}
      <ModalSheet
        footer={<PrimaryButton label="Done" onPress={() => setImpactOpen(false)} />}
        onClose={() => setImpactOpen(false)}
        title="Environmental Impact"
        visible={impactOpen}
      >
        <View style={styles.shockModal}>
          <View style={[styles.shockIcon, { backgroundColor: palette.green }]}>
            <Ionicons color="#FFFFFF" name="leaf" size={32} />
          </View>
          <Text style={[styles.shockTitle, { color: colors.text }]}>Impact data unavailable</Text>
          <Text style={[styles.shockBody, { color: colors.textMuted }]}>
            The current backend has no measured solar generation, self-powered percentage or emissions data for this home.
          </Text>
        </View>
      </ModalSheet>

      {/* --- MODAL SHEET 3: Go Off-Grid --- */}
      <ModalSheet
        footer={<PrimaryButton label="Done" onPress={() => setOffGridOpen(false)} />}
        onClose={() => setOffGridOpen(false)}
        title="Go Off-Grid Mode"
        visible={offGridOpen}
      >
        <View style={styles.shockModal}>
          <View style={[styles.shockIcon, { backgroundColor: palette.amber }]}>
            <Ionicons color="#000000" name="flash-off" size={32} />
          </View>
          <Text style={[styles.shockTitle, { color: colors.text }]}>Powerwall Islanding</Text>
          <Text style={[styles.shockAmount, { color: colors.text }]}>Seamless Backup</Text>
          <Text style={[styles.shockBody, { color: colors.textMuted }]}>
            During grid outages, Powerwall disconnects from the grid in milliseconds, keeping your lights, Wi-Fi, and
            appliances running uninterrupted.
          </Text>
        </View>
      </ModalSheet>

      {/* --- MODAL SHEET 4: Bill Outlook --- */}
      <ModalSheet
        footer={
          <PrimaryButton
            icon="sparkles-outline"
            label="Ask Sparky AI to help"
            onPress={() => {
              setBillShockOpen(false);
              router.push({ pathname: '/assistant', params: { billPrediction: String(Date.now()) } });
            }}
            variant="blue"
          />
        }
        onClose={() => setBillShockOpen(false)}
        title="Bill prediction"
        visible={billShockOpen}
      >
        <View style={styles.shockModal}>
          <BillRingGauge onToneChange={setRingTone} tone={billShockTone} value={gaugePercentage} />
          {dashboard?.warningTriggered && dashboard.overshootPct != null ? <View style={styles.overshootCallout}>
            <Ionicons color={palette.red} name="alert-circle" size={24} />
            <View style={styles.overshootCopy}>
              <Text style={[styles.overshootValue, { color: colors.text }]}>{dashboard.overshootPct.toFixed(1)}% over expected</Text>
              <Text style={[styles.overshootDetail, { color: colors.textMuted }]}>Projected {money(dashboard.overshootNzd)} above {dashboard.expectationBasis === 'comparable_homes' ? 'comparable homes' : 'your usual amount'}.</Text>
            </View>
          </View> : null}
          <View style={[styles.insightCard, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={[styles.insightIcon, { backgroundColor: animatedBillShockColor }]}>
              <Ionicons color="#FFFFFF" name="flash" size={17} />
            </View>
            <View style={styles.insightCopy}>
              <Text style={[styles.insightTitle, { color: colors.text }]}>{insightTitle}</Text>
              <Text style={[styles.insightBody, { color: colors.textMuted }]}>Ask Sparky AI for possible reasons</Text>
            </View>
          </View>
          <View style={styles.compareRow}>
            <View style={[styles.compareChip, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Text style={[styles.compareLabel, { color: colors.textMuted }]}>EXPECTED</Text>
              <Text style={[styles.compareValue, { color: colors.text }]}>{money(dashboard?.expectedCostNzd)}</Text>
            </View>
            <View style={[styles.compareChip, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Text style={[styles.compareLabel, { color: colors.textMuted }]}>PROJECTED</Text>
              <Text style={[styles.compareValue, { color: colors.text }]}>{money(dashboard?.projectedCycleCostNzd)}</Text>
            </View>
          </View>
        </View>
      </ModalSheet>


    </Screen>
  );
}

function MetricCard({ color, icon, label, value }: { color: string; icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { colors } = useAppTheme();
  return <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons color={color} name={icon} size={20} /><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  dataError: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 14, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10 },
  dataErrorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    position: 'relative',
  },
  fixedBackdrop: { backgroundColor: '#101217', left: 0, position: 'absolute', right: 0, top: 0 },
  blurLayer: { zIndex: 20 },
  blurShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,10,13,0.24)' },
  listViewport: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  listScrollView: { flex: 1 },
  homeListScrollContent: { paddingBottom: 24 },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    backgroundColor: '#101217',
    paddingBottom: 40,
  },
  menuList: {
    marginTop: 8,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  cardArea: { marginTop: 8, marginHorizontal: 16, gap: 12 },
  dashboardList: { gap: 2 },
  dashboardRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 9 },
  dashboardRowIcon: { alignItems: 'center', borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  dashboardRowCopy: { flex: 1 },
  dashboardRowTitle: { fontSize: 16, fontWeight: '800' },
  dashboardRowDetail: { marginTop: 3, fontSize: 12, lineHeight: 16 },
  billShockCard: { borderWidth: 1, borderRadius: 22, padding: 14, paddingBottom: 6 },
  overshootCallout: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1.5, borderColor: palette.red, borderRadius: 16, backgroundColor: 'rgba(232,33,39,0.13)' },
  overshootCopy: { flex: 1 },
  overshootValue: { fontSize: 19, lineHeight: 25, fontWeight: '800' },
  overshootDetail: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  billShockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  warningIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  featuredEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  featuredTitle: { marginTop: 3, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  featuredValue: { marginTop: 12, fontSize: 25, fontWeight: '700', letterSpacing: -0.8 },
  featuredCaption: { marginTop: 2, fontSize: 11 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48.5%', minHeight: 120, borderWidth: 1, borderRadius: 20, padding: 14, justifyContent: 'space-between' },
  metricLabel: { marginTop: 12, fontSize: 11, fontWeight: '700', lineHeight: 14 },
  metricValue: { marginTop: 5, fontSize: 18, fontWeight: '700', letterSpacing: -0.45 },
  menuRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  menuCopy: {
    flex: 1,
    minWidth: 0,
  },
  menuTitle: {
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  menuSubtitle: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: palette.red,
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.65,
  },
  // Welcome Modal
  welcomeModal: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  welcomeSubtitle: {
    fontSize: 14.5,
    lineHeight: 22,
    marginBottom: 24,
  },
  welcomeFeatures: {
    gap: 20,
  },
  welcomeFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  featureIconWrap: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  featureText: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '600',
  },
  // Modals
  shockModal: {
    alignItems: 'center',
    paddingTop: 12,
  },
  shockIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
    backgroundColor: palette.red,
  },
  shockTitle: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '700',
  },
  shockAmount: {
    marginTop: 6,
    fontSize: 36,
    fontWeight: '600',
    letterSpacing: -1.2,
  },
  shockBody: {
    maxWidth: 420,
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  insightCard: {
    alignSelf: 'stretch',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    padding: 15,
  },
  insightIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 13,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  insightCopy: { flex: 1, justifyContent: 'center' },
  insightTitle: { fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  insightBody: { fontSize: 12.5, fontWeight: '500', lineHeight: 19, marginTop: 5 },
  compareRow: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 12 },
  compareChip: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    paddingVertical: 11,
  },
  compareLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  compareValue: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  notificationIntro: {
    marginBottom: 8,
    fontSize: 12,
  },
  notificationList: {},
  notificationRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  notificationCopy: {
    flex: 1,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.violet,
  },
  notificationDetail: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  notificationTime: {
    marginTop: 6,
    fontSize: 10,
  },
});
