import { Fragment, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient as Gradient } from 'expo-linear-gradient';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/* ------------------------------------------------------------------ */
/*  Ring: two arcs with arrowheads (rotates continuously, clockwise)   */
/* ------------------------------------------------------------------ */
function RingSvg({ size, color }: { size: number; color: string }) {
  return (
    <Svg height={size} viewBox="0 0 256 256" width={size}>
      <Path d="M33 128A95 95 0 0 1 208.6 77.6" fill="none" stroke={color} strokeLinecap="round" strokeWidth={15} />
      <Path d="M226 96L222 68L197 85Z" fill={color} stroke={color} strokeLinejoin="round" strokeWidth={5} />
      <Path d="M223 128A95 95 0 0 1 47.4 178.4" fill="none" stroke={color} strokeLinecap="round" strokeWidth={15} />
      <Path d="M30 160L34 188L59 171Z" fill={color} stroke={color} strokeLinejoin="round" strokeWidth={5} />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Bolt: inner lightning (flips front -> back -> front, in place)     */
/* ------------------------------------------------------------------ */
function BoltSvg({ size }: { size: number }) {
  return (
    <Svg height={size} viewBox="0 0 256 256" width={size}>
      <Defs>
        <LinearGradient gradientUnits="userSpaceOnUse" id="keaBoltAnim" x1="102" x2="158" y1="61" y2="197">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.54" stopColor="#E5E5EA" />
          <Stop offset="1" stopColor="#AEAEB2" />
        </LinearGradient>
      </Defs>
      <Path
        d="M143 54L137 110L166.5 119.4Q178 123 170.1 131.9L109 201L117 149L89 139.4Q79 136 87 125.8Z"
        fill="url(#keaBoltAnim)"
        stroke="url(#keaBoltAnim)"
        strokeLinejoin="round"
        strokeWidth={3.5}
        transform="translate(-12.8 -12.8) scale(1.1)"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/*  AnimatedLogo: ring orbits, bolt does a 3D flip on its own axis     */
/* ------------------------------------------------------------------ */
export function AnimatedLogo({
  size = 40,
  color = '#FFFFFF',
  style,
}: {
  size?: number;
  color?: string;
  style?: ViewStyle;
}) {
  const [spin] = useState(() => new Animated.Value(0));
  const [flip] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // Outer arrows: continuous circular motion along their direction
    const ringAnim = Animated.loop(
      Animated.timing(spin, { duration: 5000, easing: Easing.linear, toValue: 1, useNativeDriver: true }),
    );
    // Inner bolt: front -> back -> front spin, stays in place
    const boltAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(flip, { duration: 1500, easing: Easing.inOut(Easing.ease), toValue: 1, useNativeDriver: true }),
        Animated.timing(flip, { duration: 1500, easing: Easing.inOut(Easing.ease), toValue: 0, useNativeDriver: true }),
      ]),
    );
    ringAnim.start();
    boltAnim.start();
    return () => {
      ringAnim.stop();
      boltAnim.stop();
    };
  }, [flip, spin]);

  const ringRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const boltFlip = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Animated.View style={[{ height: size, width: size }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: ringRotate }] }]}>
        <RingSvg color={color} size={size} />
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ perspective: 500 }, { rotateY: boltFlip }] }]}
      >
        <BoltSvg size={size} />
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  ElectricText: electric-storm flicker + glow + arc flashes          */
/* ------------------------------------------------------------------ */
const ARC_PATHS = [
  'M4 31 L28 23 L44 28 L70 13 L88 19 L118 7 L138 13 L168 6 L196 11',
  'M2 11 L30 17 L52 10 L82 21 L108 13 L140 23 L166 15 L198 21',
  'M10 20 L34 26 L58 18 L86 30 L112 20 L142 32 L170 22 L194 28',
];

export function ElectricText({
  children,
  style,
  mode = 'reveal',
}: {
  children: string;
  style?: TextStyle;
  mode?: 'reveal' | 'calm';
}) {
  const calm = mode === 'calm';
  const [intro] = useState(() => new Animated.Value(calm ? 1 : 0));
  const [introScale] = useState(() => new Animated.Value(calm ? 1 : 0.9));
  const [flicker] = useState(() => new Animated.Value(1));
  const [surge] = useState(() => new Animated.Value(0));
  const [arcFlash] = useState(() => new Animated.Value(calm ? 0 : 1));

  useEffect(() => {
    // Electric load-in: the text charges up with flickers instead of sitting pre-loaded
    if (!calm) {
      Animated.parallel([
        Animated.sequence([
          Animated.timing(intro, { duration: 130, toValue: 0.3, useNativeDriver: false }),
          Animated.timing(intro, { duration: 80, toValue: 0.06, useNativeDriver: false }),
          Animated.timing(intro, { duration: 110, toValue: 0.65, useNativeDriver: false }),
          Animated.timing(intro, { duration: 70, toValue: 0.18, useNativeDriver: false }),
          Animated.timing(intro, { duration: 180, toValue: 1, useNativeDriver: false }),
        ]),
        Animated.timing(introScale, {
          duration: 750,
          easing: Easing.out(Easing.back(1.3)),
          toValue: 1,
          useNativeDriver: false,
        }),
      ]).start();
    }
    // Irregular electric flicker on the text itself
    const flickerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { duration: 2300, toValue: 1, useNativeDriver: false }),
        Animated.timing(flicker, { duration: 70, toValue: 0.84, useNativeDriver: false }),
        Animated.timing(flicker, { duration: 90, toValue: 1, useNativeDriver: false }),
        Animated.timing(flicker, { duration: 60, toValue: 0.92, useNativeDriver: false }),
        Animated.timing(flicker, { duration: 1400, toValue: 1, useNativeDriver: false }),
      ]),
    );
    // Breathing electric-blue halo
    const surgeAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(surge, { duration: 1900, easing: Easing.inOut(Easing.ease), toValue: 1, useNativeDriver: false }),
        Animated.timing(surge, { duration: 1900, easing: Easing.inOut(Easing.ease), toValue: 0, useNativeDriver: false }),
      ]),
    );
    // Lightning arcs crackle across the text: burst on load, then every few seconds
    const arcAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(arcFlash, { duration: 600, toValue: 0, useNativeDriver: false }),
        Animated.timing(arcFlash, { duration: 2400, toValue: 0, useNativeDriver: false }),
        Animated.timing(arcFlash, { duration: 70, toValue: 1, useNativeDriver: false }),
        Animated.timing(arcFlash, { duration: 140, toValue: 0, useNativeDriver: false }),
        Animated.timing(arcFlash, { duration: 60, toValue: 0.85, useNativeDriver: false }),
        Animated.timing(arcFlash, { duration: 3200, toValue: 0, useNativeDriver: false }),
      ]),
    );
    flickerAnim.start();
    surgeAnim.start();
    arcAnim.start();
    return () => {
      flickerAnim.stop();
      surgeAnim.stop();
      arcAnim.stop();
    };
  }, [arcFlash, calm, flicker, intro, introScale, surge]);

  const glowRadius = surge.interpolate({ inputRange: [0, 1], outputRange: calm ? [4, 10] : [8, 26] });
  const glowStrength = surge.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const textOpacity = Animated.multiply(Animated.multiply(intro, flicker), glowStrength);

  return (
    <Animated.View style={{ opacity: textOpacity, position: 'relative', transform: [{ scale: introScale }] }}>
      <Svg
        height="100%"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
        viewBox="0 0 200 40"
        width="100%"
      >
        {ARC_PATHS.map((d) => (
          <Fragment key={d}>
            <AnimatedPath
              d={d}
              fill="none"
              opacity={arcFlash}
              stroke="#2E9BFF"
              strokeLinecap="round"
              strokeWidth={3.5}
            />
            <AnimatedPath
              d={d}
              fill="none"
              opacity={arcFlash}
              stroke="#FFFFFF"
              strokeLinecap="round"
              strokeWidth={1.3}
            />
          </Fragment>
        ))}
      </Svg>
      {/* Blue electric halo layer */}
      <Animated.Text
        style={[
          style,
          {
            color: '#EAF7FF',
            left: 0,
            position: 'absolute',
            textShadowColor: '#2E9BFF',
            textShadowOffset: { height: 0, width: 0 },
            textShadowRadius: glowRadius,
            top: 0,
          },
        ]}
      >
        {children}
      </Animated.Text>
      {/* Hot white core layer */}
      <Animated.Text
        style={[
          style,
          {
            color: '#FFFFFF',
            textShadowColor: '#BFE6FF',
            textShadowOffset: { height: 0, width: 0 },
            textShadowRadius: 5,
          },
        ]}
      >
        {children}
      </Animated.Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  LogoReveal: cinematic electric-surge intro. Glowing particles and   */
/*  lightning surges converge, a flash forms the logo, then the energy */
/*  dissipates leaving a sleek metallic mark with gentle ambient life. */
/* ------------------------------------------------------------------ */

const FIELD_W = 300;
const FIELD_H = 130;
const CX = FIELD_W / 2;
const CY = FIELD_H / 2;
const PARTICLE_COUNT = 18;

type RevealParticle = { delay: number; drift: number; size: number; sx: number; sy: number };

function makeRevealParticles(): RevealParticle[] {
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pts: RevealParticle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const rx = (0.8 + rand() * 0.4) * (FIELD_W / 2);
    const ry = (0.8 + rand() * 0.4) * (FIELD_H / 2);
    pts.push({
      delay: rand() * 0.38,
      drift: (rand() - 0.5) * 24,
      size: 3 + rand() * 5,
      sx: CX + Math.cos(angle) * rx,
      sy: CY + Math.sin(angle) * ry,
    });
  }
  return pts;
}

const SURGE_PATHS = [
  'M6 100 L40 82 L66 92 L104 64 L140 76 L180 48 L224 60 L262 34 L294 44',
  'M4 32 L38 46 L70 34 L110 56 L148 42 L188 62 L230 48 L268 60 L296 50',
  'M20 114 L60 96 L100 108 L150 86 L200 100 L250 78 L290 90',
];

export function LogoReveal({ textStyle }: { textStyle?: TextStyle }) {
  const [intro] = useState(() => new Animated.Value(0));
  const [settled, setSettled] = useState(false);
  const [particles] = useState(makeRevealParticles);

  useEffect(() => {
    const anim = Animated.timing(intro, {
      duration: 3000,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setSettled(true);
    });
    return () => anim.stop();
  }, [intro]);

  // Energy core: faint ambient glow -> raging storm -> condenses into the logo
  const coreOpacity = intro.interpolate({
    inputRange: [0, 0.15, 0.4, 0.58, 0.78],
    outputRange: [0.22, 0.22, 0.9, 1, 0],
    extrapolate: 'clamp',
  });
  const coreScale = intro.interpolate({
    inputRange: [0, 0.15, 0.55, 0.78],
    outputRange: [1.2, 1.2, 1.5, 0.6],
    extrapolate: 'clamp',
  });
  // The logo condenses out of the energy with a slight overshoot
  const rowOpacity = intro.interpolate({ inputRange: [0.58, 0.72], outputRange: [0, 1], extrapolate: 'clamp' });
  const rowScale = intro.interpolate({
    inputRange: [0.58, 0.72, 0.85, 1],
    outputRange: [0.85, 1.03, 1, 1],
    extrapolate: 'clamp',
  });
  // Crackling surges while the storm rages
  const surgeOpacity = intro.interpolate({
    inputRange: [0.1, 0.35, 0.6, 0.75],
    outputRange: [0, 1, 0.9, 0],
    extrapolate: 'clamp',
  });
  // Converge flash
  const flashOpacity = intro.interpolate({
    inputRange: [0.55, 0.62, 0.78],
    outputRange: [0, 0.95, 0],
    extrapolate: 'clamp',
  });
  // Metallic light sweep across the freshly formed logo
  const sheenX = intro.interpolate({ inputRange: [0.7, 0.92], outputRange: [-160, 160], extrapolate: 'clamp' });
  const sheenOp = intro.interpolate({
    inputRange: [0.7, 0.78, 0.92],
    outputRange: [0, 0.7, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={revealStyles.wrap}>
      {/* Logo mark: full cinematic reveal + continuous spin, unchanged.
          The wordmark is intentionally static — it fades in with the row and
          then never moves: no flicker, no charge-up, no zoom. */}
      <View style={revealStyles.row}>
        <Animated.View style={{ opacity: rowOpacity, transform: [{ scale: rowScale }] }}>
          <AnimatedLogo size={40} />
        </Animated.View>
        <Animated.View style={{ opacity: rowOpacity }}>
          <Text
            style={[
              textStyle,
              {
                color: '#FFFFFF',
                textShadowColor: '#2E9BFF',
                textShadowOffset: { height: 0, width: 0 },
                textShadowRadius: 8,
              },
            ]}
          >
            Kea Energy
          </Text>
        </Animated.View>
      </View>

      {!settled && (
        <View pointerEvents="none" style={revealStyles.fxLayer}>
          {/* Energy core: the storm the logo condenses from */}
          <Animated.View
            pointerEvents="none"
            style={[revealStyles.core, { opacity: coreOpacity, transform: [{ scale: coreScale }] }]}
          >
            <Svg height={220} viewBox="0 0 220 220" width={220}>
              <Defs>
                <RadialGradient cx="50%" cy="50%" id="stormCore" r="50%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
                  <Stop offset="35%" stopColor="#9FDCFF" stopOpacity={0.9} />
                  <Stop offset="65%" stopColor="#2E9BFF" stopOpacity={0.45} />
                  <Stop offset="100%" stopColor="#2E9BFF" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={110} cy={110} fill="url(#stormCore)" r={110} />
            </Svg>
          </Animated.View>
          {/* Crackling surges */}
          <Svg height={FIELD_H} style={revealStyles.surge} viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} width={FIELD_W}>
            {SURGE_PATHS.map((d) => (
              <Fragment key={d}>
                <AnimatedPath
                  d={d}
                  fill="none"
                  opacity={surgeOpacity}
                  stroke="#2E9BFF"
                  strokeLinecap="round"
                  strokeWidth={4}
                />
                <AnimatedPath
                  d={d}
                  fill="none"
                  opacity={surgeOpacity}
                  stroke="#FFFFFF"
                  strokeLinecap="round"
                  strokeWidth={1.4}
                />
              </Fragment>
            ))}
          </Svg>
          {/* Glowing particles converging into the logo */}
          {particles.map((pt, i) => {
            const px = intro.interpolate({
              inputRange: [pt.delay, pt.delay + 0.34],
              outputRange: [pt.sx + pt.drift, CX],
              extrapolate: 'clamp',
            });
            const py = intro.interpolate({
              inputRange: [pt.delay, pt.delay + 0.34],
              outputRange: [pt.sy, CY],
              extrapolate: 'clamp',
            });
            const pOp = intro.interpolate({
              inputRange: [pt.delay, pt.delay + 0.28, pt.delay + 0.42],
              outputRange: [0, 1, 0],
              extrapolate: 'clamp',
            });
            const pScale = intro.interpolate({
              inputRange: [pt.delay, pt.delay + 0.34],
              outputRange: [0.6, 1.5],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  revealStyles.particle,
                  {
                    borderRadius: pt.size / 2,
                    height: pt.size,
                    opacity: pOp,
                    transform: [{ translateX: px }, { translateY: py }, { scale: pScale }],
                    width: pt.size,
                  },
                ]}
              />
            );
          })}
          {/* Converge flash */}
          <Animated.View pointerEvents="none" style={[revealStyles.flash, { opacity: flashOpacity }]} />
          {/* Metallic sheen sweep across the freshly formed logo */}
          <Animated.View pointerEvents="none" style={[revealStyles.sheenWrap, { opacity: sheenOp }]}>
            <Animated.View style={{ transform: [{ translateX: sheenX }] }}>
              <Gradient
                colors={['transparent', 'rgba(255,255,255,0.85)', 'transparent']}
                end={{ x: 1, y: 0 }}
                start={{ x: 0, y: 0 }}
                style={revealStyles.sheen}
              />
            </Animated.View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const revealStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  fxLayer: {
    height: FIELD_H,
    left: '50%',
    marginLeft: -FIELD_W / 2,
    marginTop: -FIELD_H / 2,
    position: 'absolute',
    top: '50%',
    width: FIELD_W,
  },
  core: {
    left: '50%',
    marginLeft: -110,
    marginTop: -110,
    position: 'absolute',
    top: '50%',
  },
  surge: { position: 'absolute' },
  particle: {
    backgroundColor: '#BFE6FF',
    elevation: 4,
    left: 0,
    position: 'absolute',
    shadowColor: '#5FBFFF',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    top: 0,
  },
  flash: {
    backgroundColor: '#DCEEFF',
    borderRadius: 24,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheenWrap: {
    height: 64,
    left: '50%',
    marginLeft: -130,
    marginTop: -32,
    overflow: 'hidden',
    position: 'absolute',
    top: '50%',
    width: 260,
  },
  sheen: { height: 64, width: 70 },
});
