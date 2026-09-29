import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Reanimated, { cancelAnimation, Easing as ReanimatedEasing, useAnimatedProps, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { fetchHouseholdWeather, WEATHER_REFRESH_MS, type AucklandWeather } from '@/lib/auckland-weather';
import { loadLiveHomePower, type LivePower } from '@/lib/home-assistant';
import { loadHomeScene, type HomeSceneData } from '@/lib/home-scene-data';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { AnimatedLogo } from './animated-logo';
import { HIGHLIGHT_COLOR, VisualHighlight, type HighlightTarget } from './visual-highlight';

type Device = HighlightTarget;
type Source = 'solar' | 'battery' | 'grid' | 'load';

type Props = {
  customerId: string | null;
  onOpenInfo?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
  onProtectedHeaderHeightChange?: (height: number) => void;
  sceneOpacity?: Animated.AnimatedInterpolation<number> | Animated.Value | number;
};

// Traced on Akash Nair's architectural image, in its 2048 × 1117.091 viewBox.
const PIPE_PATHS = {
  solar: 'M1460 311 Q1471 316 1459 321 L1338 363 Q1323 368 1333 379 L1425 461 Q1433 467 1433 480 L1432 571 Q1432 581 1422 584 L1410 587 Q1399 590 1399 601 L1399 628',
  battery: 'M1393 697 L1393 768 Q1393 776 1385 781 L1291 817 Q1281 821 1281 812 L1281 800',
  grid: 'M1401 697 L1401 770 Q1401 778 1409 782 L1425 789 Q1432 793 1435 801 L1525 832 Q1538 837 1550 832 L1805 727',
  car: 'M1155 768 C1156 811 1155 850 1144 872 C1139 883 1131 891 1118 899 C1065 930 994 961 950 965 C920 969 906 956 902 939 C898 922 900 905 888 895 L883 892',
} as const;

const POWER_COLOR = HIGHLIGHT_COLOR.home;
const COLORS: Record<Source, string> = { solar: HIGHLIGHT_COLOR.solar, battery: HIGHLIGHT_COLOR.battery, grid: HIGHLIGHT_COLOR.grid, load: HIGHLIGHT_COLOR.car };
const AnimatedPath = Reanimated.createAnimatedComponent(Path);

function FlowPath({ id, source, reverse, active, phase }: { id: keyof typeof PIPE_PATHS; source: Source; reverse: boolean; active: boolean; phase: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: reverse ? phase.value : -phase.value }));
  const props = { d: PIPE_PATHS[id], fill: 'none' as const, stroke: COLORS[source], strokeDasharray: '18 44', strokeLinecap: 'round' as const, strokeWidth: 6 };
  return active ? <AnimatedPath {...props} animatedProps={animatedProps} /> : <Path {...props} />;
}

function weatherIcon(weather: AucklandWeather | null): keyof typeof Ionicons.glyphMap {
  if (!weather) return 'cloud-outline';
  if (!weather.isDay) return 'moon-outline';
  if (weather.condition === 'rain' || weather.condition === 'drizzle') return 'rainy-outline';
  if (weather.condition === 'storm') return 'thunderstorm-outline';
  if (weather.condition === 'cloudy' || weather.condition === 'fog') return 'cloudy-outline';
  if (weather.condition === 'partly-cloudy') return 'partly-sunny-outline';
  return 'sunny-outline';
}

function sceneColors(weather: AucklandWeather | null): [string, string, string, string] {
  if (!weather) return ['#141A22', '#22313D', '#1A232A', '#111111'];
  if (!weather.isDay) return ['#11151D', '#18273E', '#223242', '#111111'];
  if (weather.sunriseAt && weather.sunsetAt && Math.min(weather.observedAt - weather.sunriseAt, weather.sunsetAt - weather.observedAt) < 60 * 60 * 1000) return ['#2A2430', '#6B5B75', '#465066', '#111111'];
  if (['rain', 'storm', 'fog'].includes(weather.condition)) return ['#1C2329', '#465561', '#323E46', '#111111'];
  if (weather.condition === 'cloudy') return ['#202A32', '#587384', '#3E4F58', '#111111'];
  return ['#1C374A', '#4EA4CF', '#95D4EE', '#111111'];
}

function deviceEnergy(scene: HomeSceneData | null, deviceClass: string): number | null {
  if (!scene) return null;
  const values = scene.devices.filter((item) => item.deviceClass === deviceClass);
  return values.length ? values.reduce((sum, item) => sum + item.energyKwh, 0) : null;
}

function reading(scene: HomeSceneData | null, live: LivePower, device: Device): { value: string; detail: string; color: string } {
  const meterKwh = scene?.meterImportKwh ?? null;
  const measured = (value: number | null) => value === null ? '—' : `${value.toFixed(1)} kWh`;
  const current = (watts: number | undefined) => watts === undefined ? null : `${(watts / 1000).toFixed(2)} kW`;
  switch (device) {
    case 'solar': {
      const solarEnergy = deviceEnergy(scene, 'solar_generation');
      if (live.solar_generation !== undefined) return { value: current(live.solar_generation)!, detail: 'Solar output · live', color: COLORS.solar };
      if (solarEnergy !== null) return { value: measured(solarEnergy), detail: 'Solar meter · latest day', color: COLORS.solar };
      return { value: 'N/A', detail: 'No solar connected', color: COLORS.solar };
    }
    case 'home': return { value: current(live.home_load) ?? '—', detail: live.home_load !== undefined ? 'Home load · live' : 'No home power sensor', color: POWER_COLOR };
    case 'car': {
      const evEnergy = deviceEnergy(scene, 'ev_charger');
      if (live.ev_charger !== undefined) return { value: current(live.ev_charger)!, detail: 'Charger · live', color: POWER_COLOR };
      if (evEnergy !== null) return { value: measured(evEnergy), detail: 'Charger meter · latest day', color: POWER_COLOR };
      return { value: 'N/A', detail: 'No EV charger', color: HIGHLIGHT_COLOR.car };
    }
    case 'battery': {
      const charge = deviceEnergy(scene, 'battery_charge');
      const discharge = deviceEnergy(scene, 'battery_discharge');
      if (live.battery_charge !== undefined && live.battery_charge > 20) return { value: current(live.battery_charge)!, detail: 'Charging · live', color: COLORS.battery };
      if (live.battery_discharge !== undefined && live.battery_discharge > 20) return { value: current(live.battery_discharge)!, detail: 'Supplying · live', color: COLORS.battery };
      if (live.battery_charge !== undefined || live.battery_discharge !== undefined) return { value: current(live.battery_charge ?? live.battery_discharge)!, detail: 'Idle · live', color: COLORS.battery };
      if (charge !== null) return { value: measured(charge), detail: 'Charged · latest day', color: COLORS.battery };
      if (discharge !== null) return { value: measured(discharge), detail: 'Discharged · latest day', color: COLORS.battery };
      return { value: 'N/A', detail: 'No battery connected', color: COLORS.battery };
    }
    case 'grid': {
      if (live.grid_import !== undefined && live.grid_import > 20) return { value: current(live.grid_import)!, detail: 'Importing · live', color: COLORS.grid };
      if (live.grid_export !== undefined && live.grid_export > 20) return { value: current(live.grid_export)!, detail: 'Exporting · live', color: COLORS.grid };
      if (live.grid_import !== undefined || live.grid_export !== undefined) return { value: current(live.grid_import ?? live.grid_export)!, detail: 'Idle · live', color: COLORS.grid };
      return { value: measured(meterKwh), detail: meterKwh !== null ? scene?.dateSource === 'demo' ? 'Demo import · latest day' : 'Imported · latest day' : 'No grid reading yet', color: COLORS.grid };
    }
  }
}

export function DemoHomeView({ customerId, onOpenInfo, onOpenNotifications, onOpenProfile, onProtectedHeaderHeightChange, sceneOpacity }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const [sceneState, setScene] = useState<HomeSceneData | null>(null);
  const scene = sceneState?.customerId === customerId ? sceneState : null;
  const [liveState, setLiveState] = useState<{ customerId: string; power: LivePower } | null>(null);
  const live = liveState?.customerId === customerId ? liveState.power : {};
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [weatherState, setWeather] = useState<{ region: string; data: AucklandWeather } | null>(null);
  const weather = weatherState && weatherState.region === scene?.region ? weatherState.data : null;
  const [weatherError, setWeatherError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Device>('home');
  const [reduceMotion, setReduceMotion] = useState(true);
  const phase = useSharedValue(0);
  const animationActive = useActiveAnimation();
  const sceneTop = useRef(0);
  const weatherBottom = useRef(40);
  const sceneWidth = Math.min(width, 760);
  const sceneHeight = sceneWidth * 1117.091 / 2048;
  const bottomFadeHeight = Math.min(98, sceneHeight * 0.4);
  const chipWidth = Math.min(220, Math.round(111 * fontScale));
  const reportProtectedHeader = () => onProtectedHeaderHeightChange?.(sceneTop.current + weatherBottom.current + 8);
  const sunProgress = weather?.sunriseAt != null && weather.sunsetAt != null && weather.sunsetAt > weather.sunriseAt
    ? Math.max(0.08, Math.min((weather.observedAt - weather.sunriseAt) / (weather.sunsetAt - weather.sunriseAt), 0.92))
    : 0.65;

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    void loadHomeScene(customerId, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setScene(next); setSceneError(null); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSceneError(error instanceof Error ? error.message : 'Home readings unavailable.');
    });
    return () => controller.abort();
  }, [customerId, reload]);

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    async function refresh() {
      try {
        const next = await loadLiveHomePower(customerId!);
        if (active) setLiveState({ customerId: customerId!, power: next });
      } catch {
        if (active) setLiveState({ customerId: customerId!, power: {} });
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    const appSubscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { active = false; clearInterval(interval); appSubscription.remove(); };
  }, [customerId, reload]);

  useEffect(() => {
    const region = scene?.region;
    if (!region) return;
    const safeRegion: string = region;
    const controller = new AbortController();
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await fetchHouseholdWeather(safeRegion, controller.signal);
        if (active) { setWeather({ region: safeRegion, data: next }); setWeatherError(false); }
      } catch {
        if (active) setWeatherError(true);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, WEATHER_REFRESH_MS);
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { active = false; controller.abort(); clearInterval(interval); appSubscription.remove(); };
  }, [scene?.region, reload]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  // Each lit segment corresponds to a fresh sensor for this household. The
  // animation does not infer source allocation between solar, battery and grid.
  const hasLiveSensors = Object.keys(live).length > 0;
  const routes: { id: keyof typeof PIPE_PATHS; source: Source; reverse: boolean }[] = [
    ...(live.solar_generation !== undefined && live.solar_generation > 20 ? [{ id: 'solar' as const, source: 'solar' as const, reverse: false }] : []),
    ...(live.battery_charge !== undefined && live.battery_charge > 20 ? [{ id: 'battery' as const, source: 'battery' as const, reverse: false }] : []),
    ...(live.battery_discharge !== undefined && live.battery_discharge > 20 ? [{ id: 'battery' as const, source: 'battery' as const, reverse: true }] : []),
    ...(live.grid_import !== undefined && live.grid_import > 20 ? [{ id: 'grid' as const, source: 'grid' as const, reverse: true }] : []),
    ...(live.grid_export !== undefined && live.grid_export > 20 ? [{ id: 'grid' as const, source: 'grid' as const, reverse: false }] : []),
    ...(live.ev_charger !== undefined && live.ev_charger > 20 ? [{ id: 'car' as const, source: 'load' as const, reverse: false }] : []),
  ];
  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    if (reduceMotion || !animationActive || Platform.OS === 'web' || routes.length === 0) return;
    phase.value = withRepeat(withTiming(62, { duration: 2200, easing: ReanimatedEasing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reduceMotion, animationActive, routes.length]);
  const dayLabel = scene?.day
    ? new Date(`${scene.day}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return <View style={styles.container}>
    <View style={styles.topBar}>
      <View style={styles.logoContainer}><AnimatedLogo size={36} /><Text style={styles.topTitle}>Kea Energy</Text></View>
      <View style={styles.topIcons}>
        <Pressable accessibilityLabel="Notifications" accessibilityRole="button" hitSlop={8} onPress={onOpenNotifications} style={styles.iconBtn}><Ionicons color="#F4F5F7" name="notifications-outline" size={23} /></Pressable>
        <Pressable accessibilityLabel="Profile" accessibilityRole="button" hitSlop={8} onPress={onOpenProfile} style={styles.iconBtn}><Ionicons color="#F4F5F7" name="person-circle-outline" size={24} /></Pressable>
      </View>
    </View>
    <View style={styles.heading}>
      <View style={styles.headingCopy}><Text style={styles.eyebrow}>YOUR KEA HOME</Text><Text style={styles.headingTitle}>Energy in its element.</Text></View>
      <Pressable accessibilityLabel="About home readings" accessibilityRole="button" onPress={onOpenInfo} style={styles.infoButton}><Ionicons color="#BAC3CD" name="information-circle-outline" size={22} /></Pressable>
    </View>
    <View onLayout={({ nativeEvent: { layout } }) => { sceneTop.current = layout.y; reportProtectedHeader(); }} style={styles.sceneWrapper}>
      <Animated.View style={{ opacity: sceneOpacity ?? 1 }}>
        <View style={styles.sceneCard}>
          <LinearGradient colors={sceneColors(weather)} locations={[0, 0.38, 0.7, 1]} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[
              '#111111',
              'rgba(17,17,17,0.96)',
              'rgba(17,17,17,0.85)',
              'rgba(17,17,17,0.68)',
              'rgba(17,17,17,0.48)',
              'rgba(17,17,17,0.28)',
              'rgba(17,17,17,0.12)',
              'rgba(17,17,17,0.03)',
              'rgba(17,17,17,0)',
            ]}
            locations={[0, 0.12, 0.25, 0.40, 0.55, 0.70, 0.82, 0.93, 1]}
            pointerEvents="none"
            style={styles.topFade}
          />
          <View pointerEvents="none" style={[styles.skyOrb, !weather?.isDay && styles.skyMoon, { left: 24 + (sceneWidth - 96) * sunProgress, opacity: weather ? Math.max(0.3, 1 - weather.cloudCoverPercent / 140) : 0 }]} />
          {weather && weather.cloudCoverPercent > 35 ? <View pointerEvents="none" style={styles.skyCloud} /> : null}
          <View style={[styles.sceneArt, { height: sceneHeight, width: sceneWidth }]}>
            <Image accessible={false} source={require('../../assets/kea/kea-home.png')} style={{ height: sceneHeight, width: sceneWidth }} />
            <Svg height={sceneHeight} pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 2048 1117.091" width={sceneWidth}>
              <VisualHighlight active={animationActive} reduceMotion={reduceMotion} selected={selected} />
              {routes.map((route) => <Path key={`${route.id}-glow`} d={PIPE_PATHS[route.id]} fill="none" opacity={0.72} stroke={COLORS[route.source]} strokeLinecap="round" strokeWidth={15} />)}
              {routes.map((route) => <FlowPath active={!reduceMotion && animationActive && Platform.OS !== 'web'} key={route.id} phase={phase} {...route} />)}
            </Svg>
          </View>
          <LinearGradient colors={['rgba(17,17,17,0)', '#111111']} pointerEvents="none" style={[styles.bottomFade, { height: bottomFadeHeight }]} />
        </View>
      </Animated.View>
      <View onLayout={({ nativeEvent: { layout } }) => { weatherBottom.current = layout.y + layout.height; reportProtectedHeader(); }} style={styles.weatherInScene}><Ionicons name={weatherIcon(weather)} color="#E9F5FB" size={15} /><Text numberOfLines={1} style={styles.weatherInSceneText}>{scene?.region ? `${scene.region} · ${weather ? `${weather.temperatureC.toFixed(0)}° · ${weather.description}` : weatherError ? 'Weather unavailable' : 'Finding weather'}` : 'Location unavailable'}</Text></View>
      <Text style={styles.readingDate}>{dayLabel ? `${scene?.dateSource === 'demo' ? 'Demo period' : 'Meter'} · ${dayLabel}` : 'Daily energy unavailable'}{scene?.deviceDay ? ` · Devices · ${new Date(`${scene.deviceDay}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</Text>
      <ScrollView contentContainerStyle={styles.deviceRail} horizontal showsHorizontalScrollIndicator={false}>
        {(['solar', 'home', 'car', 'battery', 'grid'] as const).map((device) => {
          const metric = reading(scene, live, device);
          return <Pressable key={device} accessibilityLabel={`${device === 'car' ? 'EV' : device}: ${metric.value}, ${metric.detail}`} accessibilityHint={`Visual highlight locates ${device === 'car' ? 'the EV' : `the ${device}`} in the home picture; it is not a power reading.`} accessibilityRole="button" accessibilityState={{ selected: selected === device }} onPress={() => { setSelected(device); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }} style={[styles.deviceChip, { width: chipWidth }, selected === device && { borderColor: HIGHLIGHT_COLOR[device] }]}>
            <View style={styles.deviceHeading}><View style={[styles.deviceDot, { backgroundColor: metric.color }]} /><Text style={styles.deviceName}>{device === 'car' ? 'EV' : device.toUpperCase()}</Text></View>
            <Text style={styles.deviceValue}>{metric.value}</Text><Text numberOfLines={fontScale > 1.3 ? 2 : 1} style={styles.deviceDetail}>{metric.detail}</Text>
          </Pressable>;
        })}
      </ScrollView>
      {sceneError ? <Pressable accessibilityRole="button" onPress={() => setReload((current) => current + 1)} style={styles.retry}><Ionicons color={POWER_COLOR} name="refresh-outline" size={16} /><Text style={styles.retryText}>Home readings unavailable · Retry</Text></Pressable> : null}
      <Text style={styles.demoNote}>Visual highlight locates {selected === 'car' ? 'the EV' : `the ${selected}`} in the picture. {routes.length > 0 ? 'Live flow follows your connected power sensors.' : hasLiveSensors ? 'Your power sensors are idle right now.' : 'Connect a power sensor to see live energy flow.'}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', paddingBottom: 16, backgroundColor: '#111111' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 5, paddingHorizontal: 20, paddingTop: 8 },
  logoContainer: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  topTitle: { color: '#F4F5F7', flexShrink: 1, fontSize: 27, fontWeight: '700', letterSpacing: -0.7 },
  topIcons: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: 14 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', height: 36, width: 36 },
  heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 15, paddingBottom: 13, position: 'relative', zIndex: 30, elevation: 30 },
  headingCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  eyebrow: { color: '#E2E8EE', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  headingTitle: { color: '#F4F5F7', fontSize: 19, fontWeight: '700', marginTop: 4 },
  infoButton: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', height: 44, width: 44 },
  sceneWrapper: { position: 'relative', width: '100%' },
  sceneCard: { overflow: 'hidden', width: '100%' },
  sceneArt: { position: 'relative', zIndex: 2, elevation: 2 },
  weatherInScene: { alignItems: 'center', flexDirection: 'row', gap: 6, left: 20, position: 'absolute', right: 20, top: 12, zIndex: 20, elevation: 20 },
  weatherInSceneText: { color: '#E9F5FB', flexShrink: 1, fontSize: 11, fontWeight: '700' },
  skyOrb: { backgroundColor: '#FFF0BD', borderRadius: 38, height: 51, position: 'absolute', top: 28, width: 51, zIndex: 2, elevation: 2, shadowColor: '#FFF0BD', shadowOpacity: 0.5, shadowRadius: 22 },
  skyMoon: { backgroundColor: '#E8F0F7', height: 33, width: 33, borderRadius: 20, shadowColor: '#DDE9FF' },
  skyCloud: { backgroundColor: '#EFF7FA', borderRadius: 50, height: 20, opacity: 0.3, position: 'absolute', right: 68, top: 77, width: 102, zIndex: 2, elevation: 2 },
  topFade: { top: 0, height: 140, left: 0, position: 'absolute', right: 0, zIndex: 1, elevation: 1 },
  bottomFade: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 3 },
  readingDate: { color: '#8E8E8E', fontSize: 11, paddingHorizontal: 18, paddingTop: 3 },
  deviceRail: { gap: 9, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 2 },
  deviceChip: { backgroundColor: '#1A1A1A', borderColor: '#303030', borderRadius: 14, borderWidth: 1, minHeight: 85, paddingHorizontal: 11, paddingVertical: 9, width: 111 },
  deviceHeading: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  deviceDot: { borderRadius: 4, height: 7, width: 7 },
  deviceName: { color: '#A8A8A8', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  deviceValue: { color: '#F7F8F9', fontSize: 17, fontWeight: '800', marginTop: 6 },
  deviceDetail: { color: '#8E8E8E', fontSize: 10, marginTop: 3 },
  demoNote: { color: '#8E8E8E', fontSize: 11, paddingHorizontal: 18, paddingTop: 8 },
  retry: { alignItems: 'center', flexDirection: 'row', gap: 7, marginHorizontal: 18, marginTop: 10 },
  retryText: { color: '#D8D8D8', fontSize: 11 },
});
