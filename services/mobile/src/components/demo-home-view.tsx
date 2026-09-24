import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Line,
} from 'react-native-svg';
import { AnimatedLogo } from './animated-logo';
import { demoHomeScenarios, type DemoHomeScenario } from '@/data/mock';
import { palette } from '@/theme';

type Props = {
  scenario?: DemoHomeScenario;
  onOpenInfo?: () => void;
  onExit?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
};

export function DemoHomeView({
  scenario: controlledScenario,
  onOpenInfo,
  onExit,
  onOpenNotifications,
  onOpenProfile,
}: Props) {
  const activeScenario = controlledScenario ?? demoHomeScenarios[0];

  const isNight = activeScenario.id === 'night';

  return (
    <View style={styles.container}>
      {/* Sky & Ambient Background */}
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={
            ['#111111', '#0E0E0E', '#111111']
          }
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Top Bar: Title & Controls */}
      <View style={styles.topBar}>
        <View style={styles.logoContainer}>
          <AnimatedLogo size={36} />
          <Text style={styles.topTitle}>Kea Energy</Text>
        </View>
        <View style={styles.topIcons}>
          <Pressable
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onOpenNotifications}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Ionicons color="#D8D8D8" name="notifications-outline" size={24} />
          </Pressable>
          <Pressable
            accessibilityLabel="Profile"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onOpenProfile}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Ionicons color="#D8D8D8" name="person-circle-outline" size={24} />
          </Pressable>
        </View>
      </View>

      {/* Isometric Vector House Graphic */}
      <View style={styles.graphicContainer}>
        <Svg height="320" viewBox="0 0 380 320" width="100%">
          <Defs>
            {/* Sun / Sky Light Glow */}
            <RadialGradient cx="20%" cy="15%" id="sunGlow" r="50%">
              <Stop offset="0%" stopColor={isNight ? '#3A4B6B' : '#FFF9D2'} stopOpacity={isNight ? 0.2 : 0.65} />
              <Stop offset="40%" stopColor={isNight ? '#1E2D4A' : '#FFDD6B'} stopOpacity={isNight ? 0.08 : 0.2} />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </RadialGradient>

            {/* Roof Shading */}
            <SvgLinearGradient id="roofGrad" x1="0%" x2="100%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#373E4A" />
              <Stop offset="100%" stopColor="#1E232B" />
            </SvgLinearGradient>

            {/* Solar Panel Gradient */}
            <SvgLinearGradient id="solarGrad" x1="0%" x2="100%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#1C2B48" />
              <Stop offset="50%" stopColor="#121D33" />
              <Stop offset="100%" stopColor="#0B1322" />
            </SvgLinearGradient>

            {/* Solar Panel Glint */}
            <SvgLinearGradient id="solarGlint" x1="0%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#6C8DC5" stopOpacity="0.4" />
              <Stop offset="100%" stopColor="#1C2B48" stopOpacity="0.1" />
            </SvgLinearGradient>

            {/* Garage Wall */}
            <SvgLinearGradient id="garageWall" x1="0%" x2="100%" y1="0%" y2="0%">
              <Stop offset="0%" stopColor="#252A33" />
              <Stop offset="100%" stopColor="#323844" />
            </SvgLinearGradient>

            {/* Main House Wall */}
            <SvgLinearGradient id="mainWall" x1="0%" x2="100%" y1="0%" y2="0%">
              <Stop offset="0%" stopColor="#2B313D" />
              <Stop offset="100%" stopColor="#1D222A" />
            </SvgLinearGradient>

            {/* Car Paint Red */}
            <SvgLinearGradient id="carRed" x1="0%" x2="100%" y1="0%" y2="50%">
              <Stop offset="0%" stopColor="#D62734" />
              <Stop offset="60%" stopColor="#A81420" />
              <Stop offset="100%" stopColor="#660A11" />
            </SvgLinearGradient>

            {/* Powerwall Ambient Casing */}
            <SvgLinearGradient id="pwCasing" x1="0%" x2="100%" y1="0%" y2="0%">
              <Stop offset="0%" stopColor="#E6E8EB" />
              <Stop offset="70%" stopColor="#D2D6DC" />
              <Stop offset="100%" stopColor="#9AA0AC" />
            </SvgLinearGradient>

            {/* Ground Shadow */}
            <RadialGradient cx="50%" cy="50%" id="groundShadow" r="50%">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0.6" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </RadialGradient>
          </Defs>

          {/* Ambient Sun Sphere / Atmosphere */}
          <Rect fill="url(#sunGlow)" height="320" width="380" x="0" y="0" />

          {/* Ground Plane Shadow */}
          <Polygon fill="url(#groundShadow)" points="20,240 190,165 370,245 190,310" />

          {/* --- HOUSE STRUCTURE --- */}
          <G id="houseStructure">
            {/* Left Garage Outer Side Wall */}
            <Polygon fill="#1E232B" points="15,160 85,130 85,200 15,225" />

            {/* Left Garage Front Wall with Open Door */}
            <Polygon fill="url(#garageWall)" points="85,130 148,102 148,225 85,200" />

            {/* Garage Interior Shadow (Open Door Cavity) */}
            <Polygon fill="#0C0E12" points="92,168 142,146 142,223 92,201" />

            {/* Garage Pitched Roof */}
            <Polygon fill="url(#roofGrad)" points="15,160 85,130 148,102 78,132" />

            {/* Solar Panels on Garage Roof */}
            <Polygon fill="url(#solarGrad)" points="28,155 83,131 138,107 83,131" stroke="#25375A" strokeWidth="1" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="56" x2="111" y1="143" y2="119" />

            {/* Wall Connector inside Garage */}
            <Rect fill="#EAEAEA" height="12" rx="2" width="5" x="98" y="172" />
            <Path d="M103,178 Q108,188 114,194" fill="none" stroke="#D8D8D8" strokeWidth="1.2" />

            {/* Red Model 3 / EV inside Garage (Quarter Rear Angle) */}
            <G id="carModel3">
              {/* Car Body Base */}
              <Polygon fill="url(#carRed)" points="108,206 140,192 144,212 110,222" />
              {/* Car Rear Glass / Roof */}
              <Polygon fill="#111620" points="115,192 135,183 138,193 118,202" />
              {/* Car Taillight Bar */}
              <Line stroke="#FF2D55" strokeWidth="2.5" x1="109" x2="122" y1="205" y2="200" />
              <Line stroke="#FF2D55" strokeWidth="2.5" x1="130" x2="139" y1="196" y2="193" />
              {/* Car Bumper & Shadow */}
              <Polygon fill="#0E1015" points="110,222 144,212 144,217 110,225" />
            </G>

            {/* Main House Upper Roof Gable (Peak) */}
            <Polygon fill="#2C323E" points="148,102 205,75 275,108 218,135" />

            {/* Main House Back Roof Pitch */}
            <Polygon fill="#1E232B" points="80,128 148,102 205,75 137,101" />

            {/* Main Upper Solar Array Panels */}
            <Polygon fill="url(#solarGrad)" points="152,100 203,77 268,107 217,130" stroke="#25375A" strokeWidth="1.2" />
            {/* Grid division lines across solar panels */}
            <Line stroke="#384E7A" strokeWidth="0.75" x1="174" x2="239" y1="90" y2="120" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="195" x2="260" y1="81" y2="111" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="185" x2="185" y1="85" y2="115" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="210" x2="210" y1="74" y2="104" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="235" x2="235" y1="85" y2="115" />

            {/* Lower Main Roof Pitch */}
            <Polygon fill="url(#roofGrad)" points="148,102 218,135 295,170 225,137" />
            {/* Lower Solar Panels */}
            <Polygon fill="url(#solarGrad)" points="153,105 216,133 285,164 222,136" stroke="#25375A" strokeWidth="1" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="175" x2="244" y1="115" y2="143" />
            <Line stroke="#384E7A" strokeWidth="0.75" x1="197" x2="266" y1="124" y2="152" />

            {/* Main House Right Facade / Wall */}
            <Polygon fill="url(#mainWall)" points="148,225 295,170 295,240 148,295" />

            {/* Warm Illuminated Windows on House Wall */}
            <G id="houseWindows">
              {/* Window Frame 1 */}
              <Polygon fill="#161A22" points="248,198 268,190 268,214 248,222" stroke="#3A4150" strokeWidth="1" />
              {/* Glass Panes */}
              <Polygon fill="#5B6A82" points="250,200 258,197 258,209 250,212" />
              <Polygon fill="#5B6A82" points="260,196 266,194 266,206 260,208" />
              <Polygon fill="#445065" points="250,214 258,211 258,220 250,221" />
              <Polygon fill="#445065" points="260,210 266,208 266,217 260,218" />
            </G>

            {/* Wall-Mounted Tesla Powerwall Unit */}
            <G id="powerwallUnit">
              {/* Powerwall White Face */}
              <Polygon fill="url(#pwCasing)" points="162,230 178,224 178,258 162,264" />
              {/* Powerwall Side Edge */}
              <Polygon fill="#3B4250" points="160,231 162,230 162,264 160,265" />
              {/* Glowing Green LED Status Line */}
              <Line stroke={palette.green} strokeWidth="1.8" x1="162" x2="162" y1="232" y2="263" />
            </G>

            {/* Inverter / Gateway Unit next to Powerwall */}
            <Polygon fill="#323846" points="208,215 214,213 214,228 208,230" stroke="#485265" strokeWidth="0.75" />

            {/* --- ENERGY CONDUIT FLOW LINES (Yellow Glowing) --- */}
            {/* Conduit from Solar to Inverter */}
            <Line stroke="#F5C028" strokeDasharray="3,3" strokeWidth="1.6" x1="210" x2="210" y1="134" y2="214" />
            {/* Conduit from Inverter to Powerwall */}
            <Path d="M208,222 L178,233" fill="none" stroke="#F5C028" strokeWidth="1.6" />
            {/* Conduit from Inverter to House */}
            <Path d="M214,220 L246,208" fill="none" stroke="#F5C028" strokeWidth="1.6" />
            {/* Conduit to Grid (Right Offscreen) */}
            <Path d="M211,228 L230,248 L320,278" fill="none" stroke="#3A4456" strokeWidth="1.4" />
          </G>

          {/* --- LEADER CALLOUT LINES --- */}
          {/* Solar Callout Line */}
          <Line stroke="#D8D8D8" strokeWidth="0.85" x1="190" x2="190" y1="36" y2="80" />

          {/* Model 3 Callout Line */}
          <Line stroke="#D8D8D8" strokeWidth="0.85" x1="88" x2="88" y1="52" y2="188" />

          {/* Home Callout Line */}
          <Line stroke="#D8D8D8" strokeWidth="0.85" x1="285" x2="285" y1="52" y2="185" />

          {/* Powerwall Callout Line */}
          <Line stroke="#D8D8D8" strokeWidth="0.85" x1="170" x2="170" y1="266" y2="295" />

          {/* Grid Callout Line */}
          <Line stroke="#D8D8D8" strokeWidth="0.85" x1="288" x2="288" y1="268" y2="295" />
        </Svg>

        {/* --- CALLOUT TAGS (Crisp React Native Typography) --- */}

        {/* 1. SOLAR (Top Center) */}
        <View style={styles.calloutSolar}>
          <Text style={styles.calloutLabel}>SOLAR</Text>
          <Text style={styles.calloutValue}>{activeScenario.solarKw.toFixed(1)} kW</Text>
        </View>

        {/* 2. MODEL 3 (Top Left) */}
        <View style={styles.calloutEV}>
          <Text style={styles.calloutLabel}>MODEL 3</Text>
          <View style={styles.calloutRow}>
            <Text style={styles.calloutValue}>{activeScenario.evKw.toFixed(1)} kW</Text>
            {activeScenario.evCharging ? (
              <Ionicons color={palette.green} name="caret-up" size={12} style={styles.arrowIcon} />
            ) : null}
            <Text style={styles.calloutPercent}>{activeScenario.evSoc}%</Text>
          </View>
        </View>

        {/* 3. HOME (Top Right) */}
        <View style={styles.calloutHome}>
          <Text style={styles.calloutLabel}>HOME</Text>
          <Text style={styles.calloutValue}>{activeScenario.homeKw.toFixed(1)} kW</Text>
        </View>

        {/* 4. POWERWALL (Bottom Center) */}
        <View style={styles.calloutPowerwall}>
          <Text style={styles.calloutLabel}>POWERWALL</Text>
          <View style={styles.calloutRow}>
            <Text style={styles.calloutValue}>{activeScenario.powerwallKw.toFixed(1)} kW</Text>
            <Ionicons
              color={activeScenario.powerwallDischarging ? palette.red : palette.green}
              name={activeScenario.powerwallDischarging ? 'caret-down' : 'caret-up'}
              size={12}
              style={styles.arrowIcon}
            />
            <Text style={styles.calloutPercent}>{activeScenario.powerwallSoc}%</Text>
          </View>
        </View>

        {/* 5. GRID (Bottom Right) */}
        <View style={styles.calloutGrid}>
          <Text style={styles.calloutLabel}>GRID</Text>
          <Text style={styles.calloutValue}>{activeScenario.gridKw.toFixed(1)} kW</Text>
        </View>
      </View>


    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    paddingBottom: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 10,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topTitle: {
    color: '#D8D8D8',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },
  topIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graphicContainer: {
    position: 'relative',
    height: 320,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  // Callouts
  calloutSolar: {
    position: 'absolute',
    top: 6,
    alignSelf: 'center',
    alignItems: 'center',
  },
  calloutEV: {
    position: 'absolute',
    top: 22,
    left: 28,
    alignItems: 'center',
  },
  calloutHome: {
    position: 'absolute',
    top: 22,
    right: 36,
    alignItems: 'center',
  },
  calloutPowerwall: {
    position: 'absolute',
    bottom: 2,
    left: '32%',
    alignItems: 'center',
  },
  calloutGrid: {
    position: 'absolute',
    bottom: 2,
    right: '18%',
    alignItems: 'center',
  },
  calloutLabel: {
    color: '#A0A5B0',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  calloutValue: {
    color: '#D8D8D8',
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginTop: 1,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  calloutPercent: {
    color: '#D8D8D8',
    fontSize: 14.5,
    fontWeight: '700',
  },
  arrowIcon: {
    marginLeft: 2,
  },
  // Scenario Pill
  scenarioSection: {
    alignItems: 'center',
    paddingHorizontal: 18,
    marginTop: 6,
  },
  demoModeLabel: {
    color: palette.violet,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  scenarioPill: {
    width: '100%',
    maxWidth: 420,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E2430',
    borderWidth: 1.5,
    borderColor: '#38383A',
    borderRadius: 28,
    paddingHorizontal: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  pillNavBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  pillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 6,
  },
  pillCopy: {
    alignItems: 'center',
  },
  pillTitle: {
    color: '#D8D8D8',
    fontSize: 13.5,
    fontWeight: '700',
  },
  pillSubtitle: {
    color: '#9CA3AF',
    fontSize: 10.5,
    marginTop: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
