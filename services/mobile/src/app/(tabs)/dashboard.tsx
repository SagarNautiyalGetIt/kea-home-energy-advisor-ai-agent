import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { DemoHomeView } from '@/components/demo-home-view';
import { ModalSheet } from '@/components/modal-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { Screen } from '@/components/screen';
import SemiCircleGauge from '@/components/SemiCircleGauge';
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
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [listInForeground, setListInForeground] = useState(false);
  const [protectedHeaderHeight, setProtectedHeaderHeight] = useState(160);
  const [measuredHeroHeight, setMeasuredHeroHeight] = useState(0);
  const homeHeroPeekHeight = Math.max(measuredHeroHeight + 8, Math.max(380, Math.min(500, screenHeight - 240)));
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const homeSceneOpacity = scrollY.interpolate({ inputRange: [0, homeHeroPeekHeight * 0.45, homeHeroPeekHeight * 0.95], outputRange: [1, 0.55, 0.05], extrapolate: 'clamp' });
  const homeBlurOpacity = scrollY.interpolate({ inputRange: [0, 80, 180], outputRange: [0, 0.35, 0.65], extrapolate: 'clamp' });
  const gaugePercentage = dashboard?.overshootPct == null ? null : Math.min(Math.max(dashboard.overshootPct, 0), 100);
  const projectedCost = dashboard?.projectedCycleCostNzd ?? null;
  const expectedCost = dashboard?.expectedCostNzd ?? null;

  const money = (value: number | null | undefined) => (value == null ? '—' : `$${value.toFixed(2)}`);
  const expectationNote = dashboard?.expectationBasis === 'comparable_homes'
    ? 'Comparison uses similar households because a personal bill history is not available.'
    : dashboard?.expectationBasis === 'own_same_period_last_year'
      ? 'Comparison uses the same billing period last year.'
      : dashboard?.expectationBasis === 'own_recent_cycles'
        ? 'Comparison uses your recent billing cycles.'
        : 'A bill comparison is not available yet.';
  const insightTitle = dashboard?.warningTriggered == null ? 'Prediction unavailable' : dashboard.warningTriggered ? 'Running hotter than expected' : "Sparky's read";
  const insightBody = dashboard?.warningTriggered == null
    ? 'A bill projection needs more billing data. Your available meter readings still appear on the Usage page.'
    : dashboard.warningTriggered
    ? dashboard.warningReasons[0] ?? 'Your projected total is above the expected amount. Ask Sparky to review your available readings.'
    : 'You are tracking comfortably so far. This prediction blends your usage to date with typical patterns for the rest of the cycle, and the dial updates as new days land.';
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
      {/* Fixed backdrop with hero and scene blur overlay */}
      <View
        pointerEvents="box-none"
        style={[styles.fixedBackdrop, { zIndex: listInForeground ? 1 : 20 }]}
      >
        <View onLayout={(event) => {
          const height = Math.ceil(event.nativeEvent.layout.height);
          setMeasuredHeroHeight((current) => Math.abs(current - height) > 1 ? height : current);
        }} style={styles.homeHero}>
          <DemoHomeView
            customerId={session?.customerId ?? null}
            onOpenInfo={() => setWelcomeOpen(true)}
            onOpenNotifications={() => setNotificationsOpen(true)}
            onOpenProfile={() => router.push('/profile')}
            onProtectedHeaderHeightChange={setProtectedHeaderHeight}
            sceneOpacity={homeSceneOpacity}
          />
        </View>
        <Animated.View pointerEvents="none" style={[styles.sceneBlurWrap, { opacity: homeBlurOpacity, top: Math.max(160, protectedHeaderHeight) }]}>
          <BlurView intensity={24} pointerEvents="none" style={StyleSheet.absoluteFill} tint="dark" />
        </Animated.View>
      </View>

      <View style={[styles.listViewport, { zIndex: listInForeground ? 30 : 10 }]}>
        <Animated.ScrollView
          contentContainerStyle={styles.menuScrollContent}
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
          style={styles.menuScroll}
        >
          <View pointerEvents="none" style={{ height: homeHeroPeekHeight }} />

          <View style={styles.cardArea}>
            {dashboardError ? <Pressable accessibilityRole="button" onPress={() => { setDashboardError(null); setReloadKey((key) => key + 1); }} style={[styles.dataError, { borderColor: palette.red }]}><Ionicons color={palette.red} name="warning-outline" size={18} /><Text style={[styles.dataErrorText, { color: colors.text }]}>{dashboardError} Tap to retry.</Text></Pressable> : null}
            <View style={styles.dashboardList}>
              <DashboardRow detail={dashboard?.warningTriggered ? 'Bill shock warning' : 'View your bill prediction'} icon="alert-circle-outline" label="Bill prediction" onPress={() => setBillShockOpen(true)} index={0} />
              <DashboardRow detail="Track your usage" icon="analytics-outline" label="Usage" onPress={() => router.push('/usage')} index={1} />
              <DashboardRow detail="Ask Kea Energy AI" icon="sparkles-outline" label="Sparky AI" onPress={() => router.push('/assistant')} index={2} />
              <DashboardRow detail="Explore the demo community league" icon="flash-outline" label="Power Clash" onPress={() => router.push('/clash')} index={3} />
              <DashboardRow detail="View bills and payments" icon="receipt-outline" label="Billing" onPress={() => router.push('/billing')} index={4} />
              <DashboardRow detail="Account, plans and settings" icon="grid-outline" label="More" onPress={() => router.push('/more')} index={5} />
            </View>
          </View>
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
        {!dashboardNotifications.length ? <Text style={[styles.notificationDetail, { color: colors.textMuted }]}>No account alerts right now.</Text> : null}
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
            The sky reflects modelled weather for your account’s region. Energy cards show dated meter or connected-device readings when available. Power routes appear only with live power sensors.
          </Text>

          <View style={styles.welcomeFeatures}>
            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(255, 214, 10, 0.16)' }]}>
                <Ionicons color={palette.solar} name="sunny" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>Solar generation appears when a solar meter reports it</Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(48, 209, 88, 0.16)' }]}>
                <Ionicons color={palette.battery} name="battery-charging" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>
                Battery figures need a connected battery energy meter
              </Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(10, 132, 255, 0.16)' }]}>
                <Ionicons color={palette.violet} name="car-sport" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>
                EV charging figures need a connected charger meter
              </Text>
            </View>

            <View style={styles.welcomeFeatureRow}>
              <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(255, 255, 255, 0.14)' }]}>
                <Ionicons color="#FFFFFF" name="flash" size={24} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>Grid import is read from your household meter</Text>
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
            label="Ask Sparky AI"
            onPress={() => {
              setBillShockOpen(false);
              router.push('/assistant');
            }}
          />
        }
        onClose={() => setBillShockOpen(false)}
        title="Bill prediction"
        visible={billShockOpen}
      >
        <View style={styles.shockModal}>
          <SemiCircleGauge percentage={gaugePercentage} projectedCost={money(projectedCost)} />
          <View style={[styles.insightCard, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.insightIcon}>
              <Ionicons color="#FFFFFF" name="sparkles" size={17} />
            </View>
            <View style={styles.insightCopy}>
              <Text style={[styles.insightTitle, { color: colors.text }]}>{insightTitle}</Text>
              <Text style={[styles.insightBody, { color: colors.textMuted }]}>{insightBody}</Text>
            </View>
          </View>
          <View style={styles.compareRow}>
            <View style={[styles.compareChip, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Text style={[styles.compareLabel, { color: colors.textMuted }]}>EXPECTED</Text>
              <Text style={[styles.compareValue, { color: colors.text }]}>{money(expectedCost)}</Text>
            </View>
            <View style={[styles.compareChip, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Text style={[styles.compareLabel, { color: colors.textMuted }]}>PROJECTED</Text>
              <Text style={[styles.compareValue, { color: dashboard?.warningTriggered ? palette.red : colors.text }]}>{money(projectedCost)}</Text>
            </View>
          </View>
          <Text style={[styles.shockFootnote, { color: colors.textMuted }]}>{expectationNote}</Text>
        </View>
      </ModalSheet>


    </Screen>
  );
}

function DashboardRow({ icon, label, detail, onPress, index }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void; index: number }) {
  const { colors } = useAppTheme();
  return <MotionPressable accessibilityRole="button" onPress={onPress} style={styles.dashboardRow}><View style={styles.dashboardRowIcon}><Ionicons color={colors.textMuted} name={icon} size={19} /></View><View style={styles.dashboardRowCopy}><Text style={[styles.dashboardRowTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.dashboardRowDetail, { color: colors.textMuted }]}>{detail}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={21} /></MotionPressable>;
}


const styles = StyleSheet.create({
  fixedBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111111',
  },
  sceneBlurWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  listViewport: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dataError: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 14, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10 },
  dataErrorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    paddingBottom: 40,
  },
  homeHero: { position: 'relative' },
  homeBlurShade: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, backgroundColor: 'rgba(12,17,22,0.24)' },
  menuList: {
    marginTop: 8,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  cardArea: { marginTop: 8, marginHorizontal: 16, gap: 12 },
  dashboardList: { gap: 2 },
  dashboardRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 9 },
  dashboardRowIcon: { width: 30, alignItems: 'center' },
  dashboardRowCopy: { flex: 1 },
  dashboardRowTitle: { fontSize: 16, fontWeight: '800' },
  dashboardRowDetail: { marginTop: 3, fontSize: 12, lineHeight: 16 },
  billShockCard: { borderWidth: 1, borderRadius: 22, padding: 14, paddingBottom: 6 },
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
  insightCopy: { flex: 1 },
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
  shockFootnote: { fontSize: 11, lineHeight: 16, marginTop: 12, textAlign: 'center' },
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
