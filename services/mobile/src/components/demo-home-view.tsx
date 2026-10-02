import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { InteractiveHomeScene } from './interactive-home-scene';
import { GltfHomeScene } from './gltf-home-scene';
import { OutageNotice } from './outage-notice';
import { EnergyReadingRail } from './energy-reading-rail';
import { homeCardReading } from '@/lib/home-card-reading';
import { AccessibilityInfo, Animated, AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fetchHouseholdWeather, WEATHER_REFRESH_MS, type AucklandWeather } from '@/lib/auckland-weather';
import { loadLiveHomePower, type LivePower } from '@/lib/home-assistant';
import { loadHomeScene, type HomeSceneData } from '@/lib/home-scene-data';
import { useAppTheme } from '@/theme';
import { AnimatedLogo } from './animated-logo';
import { HIGHLIGHT_COLOR, type HighlightTarget } from './visual-highlight';

type Device = HighlightTarget;

type Props = {
  customerId: string | null;
  onOpenInfo?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
  onProtectedHeaderHeightChange?: (height: number) => void;
  sceneOpacity?: Animated.AnimatedInterpolation<number> | Animated.Value | number;
};

const POWER_COLOR = HIGHLIGHT_COLOR.home;

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

export function DemoHomeView({ customerId, onOpenInfo, onOpenNotifications, onOpenProfile, onProtectedHeaderHeightChange, sceneOpacity }: Props) {
  const { colors, mode } = useAppTheme();
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
  const sceneTop = useRef(0);
  const weatherBottom = useRef(40);
  const sceneWidth = Math.min(width, 760);
  const sceneHeight = sceneWidth * 0.7;
  const bottomFadeHeight = Math.min(98, sceneHeight * 0.4);
  const chipWidth = Math.min(220, Math.round(111 * fontScale));
  const reportProtectedHeader = () => onProtectedHeaderHeightChange?.(sceneTop.current + weatherBottom.current + 8);
  const sunProgress = weather?.sunriseAt != null && weather.sunsetAt != null && weather.sunsetAt > weather.sunriseAt
    ? Math.max(0.08, Math.min((weather.observedAt - weather.sunriseAt) / (weather.sunsetAt - weather.sunriseAt), 0.92))
    : 0.65;

  useFocusEffect(useCallback(() => {
    if (!customerId) return;
    const controller = new AbortController();
    setScene(null);
    setSceneError(null);
    void loadHomeScene(customerId, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setScene(next); setSceneError(null); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSceneError(error instanceof Error ? error.message : 'Home readings unavailable.');
    });
    return () => controller.abort();
    // reload deliberately invalidates the focused screen's request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, reload]));

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
  const dayLabel = scene?.day
    ? new Date(`${scene.day}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View style={styles.topBar}>
      <View style={styles.logoContainer}><AnimatedLogo color={colors.text} size={36} /><Text style={[styles.topTitle, { color: colors.text }]}>Kea Energy</Text></View>
      <View style={styles.topIcons}>
        <Pressable accessibilityLabel="Notifications" accessibilityRole="button" hitSlop={8} onPress={onOpenNotifications} style={styles.iconBtn}><Ionicons color={colors.text} name="notifications-outline" size={23} /></Pressable>
        <Pressable accessibilityLabel="Profile" accessibilityRole="button" hitSlop={8} onPress={onOpenProfile} style={styles.iconBtn}><Ionicons color={colors.text} name="person-circle-outline" size={24} /></Pressable>
      </View>
    </View>
    <View style={styles.heading}>
      <View style={styles.headingCopy}><Text style={[styles.eyebrow, { color: colors.textMuted }]}>YOUR KEA HOME</Text><Text style={[styles.headingTitle, { color: colors.text }]}>Energy in its element.</Text></View>
      <Pressable accessibilityLabel="About home readings" accessibilityRole="button" onPress={onOpenInfo} style={styles.infoButton}><Ionicons color={colors.textMuted} name="information-circle-outline" size={22} /></Pressable>
    </View>
    <View onLayout={({ nativeEvent: { layout } }) => { sceneTop.current = layout.y; reportProtectedHeader(); }} style={styles.sceneWrapper}>
      <Animated.View style={{ opacity: sceneOpacity ?? 1 }}>
        <View style={styles.sceneCard}>
          <LinearGradient colors={sceneColors(weather)} locations={[0, 0.38, 0.7, 1]} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={mode === 'dark' ? [
              '#111111', 'rgba(17,17,17,0.96)', 'rgba(17,17,17,0.85)',
              'rgba(17,17,17,0.68)', 'rgba(17,17,17,0.48)', 'rgba(17,17,17,0.28)',
              'rgba(17,17,17,0.12)', 'rgba(17,17,17,0.03)', 'rgba(17,17,17,0)',
            ] : [
              '#EEEEEE', 'rgba(238,238,238,0.96)', 'rgba(238,238,238,0.85)',
              'rgba(238,238,238,0.68)', 'rgba(238,238,238,0.48)', 'rgba(238,238,238,0.28)',
              'rgba(238,238,238,0.12)', 'rgba(238,238,238,0.03)', 'rgba(238,238,238,0)',
            ]}
            locations={[0, 0.12, 0.25, 0.40, 0.55, 0.70, 0.82, 0.93, 1]}
            pointerEvents="none"
            style={styles.topFade}
          />
          <View pointerEvents="none" style={[styles.skyOrb, !weather?.isDay && styles.skyMoon, { left: 24 + (sceneWidth - 96) * sunProgress, opacity: weather ? Math.max(0.3, 1 - weather.cloudCoverPercent / 140) : 0 }]} />
          {weather && weather.cloudCoverPercent > 35 ? <View pointerEvents="none" style={styles.skyCloud} /> : null}
          <InteractiveHomeScene reduceMotion={reduceMotion}>
            {(camera) => <View style={[styles.sceneArt, { height: sceneHeight, width: sceneWidth }]}>
              <GltfHomeScene camera={camera} width={sceneWidth} height={sceneHeight} />
            </View>}
          </InteractiveHomeScene>
          <LinearGradient colors={mode === 'dark' ? ['rgba(17,17,17,0)', '#111111'] : ['rgba(238,238,238,0)', '#EEEEEE']} pointerEvents="none" style={[styles.bottomFade, { height: bottomFadeHeight }]} />
        </View>
      </Animated.View>
      <View onLayout={({ nativeEvent: { layout } }) => { weatherBottom.current = layout.y + layout.height; reportProtectedHeader(); }} style={styles.weatherInScene}><Ionicons name={weatherIcon(weather)} color={mode === 'dark' ? '#E9F5FB' : colors.text} size={15} /><Text numberOfLines={1} style={[styles.weatherInSceneText, { color: mode === 'dark' ? '#E9F5FB' : colors.text }]}>{scene?.region ? `${scene.region} · ${weather ? `${weather.temperatureC.toFixed(0)}° · ${weather.description}` : weatherError ? 'Weather unavailable' : 'Finding weather'}` : 'Location unavailable'}</Text></View>
      <Text style={[styles.readingDate, { color: colors.textMuted }]}>{dayLabel ? `${scene?.dateSource === 'demo' ? 'Demo period' : 'Meter'} · ${dayLabel}` : 'Daily energy unavailable'}{scene?.deviceDay ? ` · Devices · ${new Date(`${scene.deviceDay}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</Text>
      <EnergyReadingRail cardWidth={chipWidth} selected={selected} onSelect={(device) => setSelected(device as Device)} readings={(['solar', 'home', 'car', 'battery', 'grid'] as const).map((device) => {
        const metric = homeCardReading(scene, live, device);
        return { id: device, label: device === 'car' ? 'EV' : device.toUpperCase(), value: metric.value, color: HIGHLIGHT_COLOR[device], detail: sceneError ? 'Readings unavailable' : !scene ? 'Loading readings…' : metric.detail };
      })} />
      <Pressable accessibilityRole="button" onPress={() => router.push(selected === 'home' || selected === 'grid' ? '/usage' : '/settings')} style={[styles.readingAction, { borderColor: colors.border }]}>
        <Ionicons name={selected === 'home' || selected === 'grid' ? 'bar-chart-outline' : 'link-outline'} color={colors.text} size={18} />
        <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>{selected === 'home' || selected === 'grid' ? 'View dated household imports' : `Connect or sync ${selected === 'car' ? 'EV charger' : selected} sensors`}</Text>
        <Ionicons name="chevron-forward" color={colors.textMuted} size={16} />
      </Pressable>
      {sceneError ? <Pressable accessibilityRole="button" onPress={() => setReload((current) => current + 1)} style={styles.retry}><Ionicons color={POWER_COLOR} name="refresh-outline" size={16} /><Text style={[styles.retryText, { color: colors.text }]}>Home readings unavailable · Retry</Text></Pressable> : null}
      <OutageNotice />
      <Text style={[styles.demoNote, { color: colors.textMuted }]}>Selected reading: {selected === 'car' ? 'the EV' : `the ${selected}`} · model is illustrative. Energy cards show available meter and sensor readings.</Text>
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
  bottomFade: { bottom: 51, left: 0, position: 'absolute', right: 0, zIndex: 3 },
  readingDate: { color: '#8E8E8E', fontSize: 11, paddingHorizontal: 18, paddingTop: 3 },
  deviceRail: { gap: 9, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 2 },
  deviceChip: { backgroundColor: '#1A1A1A', borderColor: '#303030', borderRadius: 14, borderWidth: 1, minHeight: 116, paddingHorizontal: 11, paddingVertical: 9, width: 111 },
  deviceHeading: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  deviceDot: { borderRadius: 4, height: 7, width: 7 },
  deviceName: { color: '#A8A8A8', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  deviceValue: { color: '#F7F8F9', fontSize: 17, fontWeight: '800', marginTop: 6 },
  deviceDetail: { color: '#8E8E8E', fontSize: 10, marginTop: 3 },
  demoNote: { color: '#8E8E8E', fontSize: 11, paddingHorizontal: 18, paddingTop: 8 },
  readingAction: { alignItems: 'center', flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: 44 },
  retry: { alignItems: 'center', flexDirection: 'row', gap: 7, marginHorizontal: 18, marginTop: 10 },
  retryText: { color: '#D8D8D8', fontSize: 11 },
});
