import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { fetchAucklandWeather, WEATHER_REFRESH_MS, WEATHER_SOURCE_URL, type AucklandWeather } from '@/lib/auckland-weather';
import { calculateEnergy, type EnergySnapshot } from '@/lib/home-energy';
import { AnimatedLogo } from './animated-logo';

type Device = 'solar' | 'home' | 'car' | 'battery' | 'grid';
type Source = 'solar' | 'battery' | 'grid';

type Props = {
  onOpenInfo?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
};

// Traced on Akash Nair's architectural image, in its 2048 × 1117.091 viewBox.
const PIPE_PATHS = {
  solar: 'M1460 311 Q1471 316 1459 321 L1338 363 Q1323 368 1333 379 L1425 461 Q1433 467 1433 480 L1432 571 Q1432 581 1422 584 L1410 587 Q1399 590 1399 601 L1399 628',
  battery: 'M1393 697 L1393 768 Q1393 776 1385 781 L1291 817 Q1281 821 1281 812 L1281 800',
  grid: 'M1401 697 L1401 770 Q1401 778 1409 782 L1425 789 Q1432 793 1435 801 L1525 832 Q1538 837 1550 832 L1805 727',
  car: 'M1155 768 C1156 811 1155 850 1144 872 C1139 883 1131 891 1118 899 C1065 930 994 961 950 965 C920 969 906 956 902 939 C898 922 900 905 888 895 L883 892',
} as const;

// Match the source Kea Energy Home scene: solar green, battery blue, grid amber.
const POWER_COLOR = '#63f09a';
const COLORS: Record<Source, string> = { solar: '#63f09a', battery: '#5ab8ff', grid: '#ff9f43' };
const AnimatedPath = Animated.createAnimatedComponent(Path);

function weatherIcon(weather: AucklandWeather | null): keyof typeof Ionicons.glyphMap {
  if (!weather) return 'cloud-outline';
  if (!weather.isDay) return 'moon-outline';
  if (weather.condition === 'rain' || weather.condition === 'drizzle') return 'rainy-outline';
  if (weather.condition === 'storm') return 'thunderstorm-outline';
  if (weather.condition === 'cloudy' || weather.condition === 'fog') return 'cloudy-outline';
  if (weather.condition === 'partly-cloudy') return 'partly-sunny-outline';
  return 'sunny-outline';
}

function sceneColors(weather: AucklandWeather | null): [string, string, string] {
  if (!weather) return ['#657D8D', '#CBD8DD', '#F1F2EE'];
  if (!weather.isDay) return ['#263B59', '#849DB2', '#E1E4E7'];
  if (['rain', 'storm', 'fog'].includes(weather.condition)) return ['#8299A5', '#CCD9DD', '#EEF1F0'];
  if (weather.condition === 'cloudy') return ['#ADC1CB', '#DBE3E5', '#F3F3EF'];
  return ['#B7D8E6', '#E1EEF1', '#F5F4F0'];
}

function dominantSource(snapshot: EnergySnapshot, device: 'home' | 'car'): Source {
  const flows = device === 'home'
    ? [snapshot.flows.solarToHomeKw, snapshot.flows.batteryToHomeKw, snapshot.flows.gridToHomeKw]
    : [snapshot.flows.solarToEvKw, snapshot.flows.batteryToEvKw, snapshot.flows.gridToEvKw];
  const largest = Math.max(...flows);
  return largest === flows[0] ? 'solar' : largest === flows[1] ? 'battery' : 'grid';
}

function reading(snapshot: EnergySnapshot | null, device: Device): { value: string; detail: string; color: string } {
  if (!snapshot) return { value: '—', detail: 'Waiting for weather', color: POWER_COLOR };
  switch (device) {
    case 'solar': return { value: `${snapshot.solarKw.toFixed(1)} kW`, detail: snapshot.solarKw > 0.05 ? 'Generating' : 'Resting', color: COLORS.solar };
    case 'home': return { value: `${snapshot.homeServedKw.toFixed(1)} kW`, detail: snapshot.homeState === 'powered' ? 'Powered' : 'Supply limited', color: COLORS[dominantSource(snapshot, 'home')] };
    case 'car': return { value: snapshot.evServedKw > 0.05 ? `${snapshot.evServedKw.toFixed(1)} kW` : 'Idle', detail: snapshot.evServedKw > 0.05 ? 'Charging' : 'Not charging', color: COLORS[dominantSource(snapshot, 'car')] };
    case 'battery': {
      const power = Math.max(snapshot.batteryChargeKw, snapshot.batteryDischargeKw);
      const state = snapshot.batteryChargeKw > 0.05 ? 'Charging' : snapshot.batteryDischargeKw > 0.05 ? 'Supplying' : 'Standing by';
      return { value: `${power.toFixed(1)} kW`, detail: `${state} · ${Math.round(snapshot.batteryPercent)}%`, color: COLORS.battery };
    }
    case 'grid': {
      const power = Math.max(snapshot.gridImportKw, snapshot.gridExportKw);
      const state = snapshot.gridImportKw > 0.05 ? 'Importing' : snapshot.gridExportKw > 0.05 ? 'Exporting' : 'Balanced';
      return { value: `${power.toFixed(1)} kW`, detail: state, color: COLORS.grid };
    }
  }
}

export function DemoHomeView({ onOpenInfo, onOpenNotifications, onOpenProfile }: Props) {
  const { width } = useWindowDimensions();
  const [weather, setWeather] = useState<AucklandWeather | null>(null);
  const [weatherError, setWeatherError] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Device>('solar');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase] = useState(() => new Animated.Value(0));
  const sceneWidth = Math.max(width + 24, 420);
  const sceneHeight = sceneWidth * 1117.091 / 2048;
  const snapshot = useMemo(() => weather ? calculateEnergy({
    solarPotential: weather.isDay ? Math.min(1, Math.max(0, (weather.solarRadiationWm2 ?? 850 * (1 - weather.cloudCoverPercent / 100 * 0.82)) / 1000)) : 0,
    batteryPercent: 65,
    reservePercent: 25,
    homeDemandKw: 1.5,
    evEnabled: true,
    evDemandKw: 2,
    gridConnected: true,
  }) : null, [weather]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await fetchAucklandWeather(controller.signal);
        if (active) { setWeather(next); setWeatherError(false); setWeatherLoading(false); }
      } catch {
        if (active) { setWeatherError(true); setWeatherLoading(false); }
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
  }, [weatherRefreshKey]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(phase, { toValue: 62, duration: 2200, useNativeDriver: false }));
    phase.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [phase, reduceMotion]);

  const routes: { id: keyof typeof PIPE_PATHS; kw: number; source: Source; reverse: boolean }[] = snapshot ? [
    { id: 'solar', kw: snapshot.solarKw, source: 'solar', reverse: false },
    { id: 'battery', kw: Math.max(snapshot.batteryChargeKw, snapshot.batteryDischargeKw), source: snapshot.batteryDischargeKw > 0.05 ? 'battery' : 'solar', reverse: snapshot.batteryDischargeKw > 0.05 },
    { id: 'grid', kw: Math.max(snapshot.gridImportKw, snapshot.gridExportKw), source: snapshot.gridImportKw > 0.05 ? 'grid' : 'solar', reverse: snapshot.gridImportKw > 0.05 },
    { id: 'car', kw: snapshot.evServedKw, source: dominantSource(snapshot, 'car'), reverse: false },
  ] : [];
  const offset = phase.interpolate({ inputRange: [0, 62], outputRange: [0, -62] });
  const reverseOffset = phase.interpolate({ inputRange: [0, 62], outputRange: [0, 62] });
  const selectedReading = reading(snapshot, selected);
  const updatedAt = weather ? new Date(weather.observedAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }) : null;

  return <View style={styles.container}>
    <View style={styles.topBar}>
      <View style={styles.logoContainer}><AnimatedLogo size={36} /><Text style={styles.topTitle}>Kea Energy</Text></View>
      <View style={styles.topIcons}>
        <Pressable accessibilityLabel="Notifications" accessibilityRole="button" hitSlop={8} onPress={onOpenNotifications} style={styles.iconBtn}><Ionicons color="#F4F5F7" name="notifications-outline" size={23} /></Pressable>
        <Pressable accessibilityLabel="Profile" accessibilityRole="button" hitSlop={8} onPress={onOpenProfile} style={styles.iconBtn}><Ionicons color="#F4F5F7" name="person-circle-outline" size={24} /></Pressable>
      </View>
    </View>
    <View style={styles.heading}>
      <View><Text style={styles.eyebrow}>YOUR KEA HOME</Text><Text style={styles.headingTitle}>Energy in its element.</Text></View>
      <Pressable accessibilityLabel="About this home preview" accessibilityRole="button" onPress={onOpenInfo} style={styles.infoButton}><Ionicons color="#BAC3CD" name="information-circle-outline" size={22} /></Pressable>
    </View>
    <View style={styles.weatherCard}>
      <View style={styles.weatherIcon}><Ionicons name={weatherIcon(weather)} color={POWER_COLOR} size={25} /></View>
      <View style={styles.weatherDetails}>
        <Text style={styles.weatherLabel}>AUCKLAND WEATHER</Text>
        <Text style={styles.weatherValue}>{weather ? `${weather.temperatureC.toFixed(1)}°C · ${weather.description}` : weatherLoading ? 'Loading current weather…' : 'Current weather unavailable'}</Text>
        <Text style={styles.weatherMeta}>{weatherError ? weather ? 'Could not refresh · showing last update' : 'Check your connection and retry' : updatedAt ? `Updated ${updatedAt} · modelled conditions` : 'Modelled current conditions'}</Text>
      </View>
      {weatherError ? <Pressable accessibilityLabel="Retry Auckland weather" accessibilityRole="button" onPress={() => { setWeatherLoading(true); setWeatherRefreshKey((key) => key + 1); }} style={styles.weatherAction}><Ionicons name="refresh" color={POWER_COLOR} size={21} /></Pressable>
        : <Pressable accessibilityLabel="Open Open-Meteo weather source" accessibilityRole="link" onPress={() => { void Linking.openURL(WEATHER_SOURCE_URL); }} style={styles.weatherAction}><Ionicons name="open-outline" color="#AFC4D2" size={18} /></Pressable>}
    </View>
    <View style={styles.sceneCard}>
      <LinearGradient colors={sceneColors(weather)} style={StyleSheet.absoluteFill} />
      <View style={[styles.sceneArt, { height: sceneHeight, width: sceneWidth, marginLeft: (width - 24 - sceneWidth) / 2 - 12 }]}>
        <Image accessibilityLabel="Kea solar home with battery, electric car, and grid connection" source={require('../../assets/kea/kea-home.png')} style={{ height: sceneHeight, width: sceneWidth }} />
        <Svg height={sceneHeight} pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 2048 1117.091" width={sceneWidth}>
          <Defs><RadialGradient id="homeGlow"><Stop offset="0" stopColor={selectedReading.color} stopOpacity="0.55" /><Stop offset="1" stopColor={selectedReading.color} stopOpacity="0" /></RadialGradient></Defs>
          {routes.filter((route) => route.kw > 0.05).map((route) => <Path key={`${route.id}-glow`} d={PIPE_PATHS[route.id]} fill="none" opacity={0.72} stroke={COLORS[route.source]} strokeLinecap="round" strokeWidth={15} />)}
          {routes.filter((route) => route.kw > 0.05).map((route) => reduceMotion || Platform.OS === 'web'
            ? <Path key={route.id} d={PIPE_PATHS[route.id]} fill="none" stroke={COLORS[route.source]} strokeDasharray="18 44" strokeLinecap="round" strokeWidth={6} />
            : <AnimatedPath key={route.id} d={PIPE_PATHS[route.id]} fill="none" stroke={COLORS[route.source]} strokeDasharray="18 44" strokeDashoffset={route.reverse ? reverseOffset : offset} strokeLinecap="round" strokeWidth={6} />)}
          <Circle cx={1578} cy={613} fill="url(#homeGlow)" r={47} />
        </Svg>
      </View>
      <View style={styles.sceneCaption}><View style={styles.modeDot} /><Text style={styles.sceneCaptionText}>EXAMPLE ENERGY FLOW</Text></View>
    </View>
    <ScrollView contentContainerStyle={styles.deviceRail} horizontal showsHorizontalScrollIndicator={false}>
      {(['solar', 'home', 'car', 'battery', 'grid'] as const).map((device) => {
        const metric = reading(snapshot, device);
        return <Pressable key={device} accessibilityLabel={`${device === 'car' ? 'EV' : device}: ${metric.value}, ${metric.detail}`} accessibilityRole="button" accessibilityState={{ selected: selected === device }} onPress={() => setSelected(device)} style={[styles.deviceChip, selected === device && { borderColor: metric.color }]}>
          <View style={styles.deviceHeading}><View style={[styles.deviceDot, { backgroundColor: metric.color }]} /><Text style={styles.deviceName}>{device === 'car' ? 'EV' : device.toUpperCase()}</Text></View>
          <Text style={styles.deviceValue}>{metric.value}</Text><Text numberOfLines={1} style={styles.deviceDetail}>{metric.detail}</Text>
        </Pressable>;
      })}
    </ScrollView>
    <Text style={styles.demoNote}>Live modelled Auckland weather · illustrative energy, not meter data. Weather: Open-Meteo.</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', paddingBottom: 16, backgroundColor: '#101217' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 5, paddingHorizontal: 20, paddingTop: 8 },
  logoContainer: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  topTitle: { color: '#F4F5F7', fontSize: 27, fontWeight: '700', letterSpacing: -0.7 },
  topIcons: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', height: 36, width: 36 },
  heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 15, paddingBottom: 13 },
  eyebrow: { color: POWER_COLOR, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  headingTitle: { color: '#F4F5F7', fontSize: 19, fontWeight: '700', marginTop: 4 },
  infoButton: { alignItems: 'center', justifyContent: 'center', height: 36, width: 36 },
  weatherCard: { alignItems: 'center', backgroundColor: '#1A2530', borderColor: '#30495A', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, marginHorizontal: 12, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10 },
  weatherIcon: { alignItems: 'center', justifyContent: 'center', height: 34, width: 34 },
  weatherDetails: { flex: 1 },
  weatherLabel: { color: POWER_COLOR, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  weatherValue: { color: '#F5F8FA', fontSize: 15, fontWeight: '700', marginTop: 2 },
  weatherMeta: { color: '#AFC4D2', fontSize: 10, marginTop: 2 },
  weatherAction: { alignItems: 'center', justifyContent: 'center', height: 34, width: 34 },
  sceneCard: { borderRadius: 19, marginHorizontal: 12, overflow: 'hidden' },
  sceneArt: { position: 'relative' },
  sceneCaption: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(17,27,36,0.85)', borderRadius: 99, bottom: 10, flexDirection: 'row', gap: 6, left: 12, paddingHorizontal: 10, paddingVertical: 5, position: 'absolute' },
  modeDot: { backgroundColor: POWER_COLOR, borderRadius: 4, height: 6, width: 6 },
  sceneCaptionText: { color: '#F4F5F7', fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  deviceRail: { gap: 9, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 2 },
  deviceChip: { backgroundColor: '#1A2028', borderColor: '#303945', borderRadius: 14, borderWidth: 1, minHeight: 85, paddingHorizontal: 11, paddingVertical: 9, width: 111 },
  deviceHeading: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  deviceDot: { borderRadius: 4, height: 7, width: 7 },
  deviceName: { color: '#B9C1CB', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  deviceValue: { color: '#F7F8F9', fontSize: 17, fontWeight: '800', marginTop: 6 },
  deviceDetail: { color: '#A9B3C0', fontSize: 9, marginTop: 3 },
  demoNote: { color: '#9AA8B6', fontSize: 10, paddingHorizontal: 18, paddingTop: 8 },
});
