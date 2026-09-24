import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AnimatedLogo } from './animated-logo';

/* ------------------------------------------------------------------ */
/*  AppIntro: high-quality animated company intro shown on cold start. */
/*  Logo mark rises out of black with rippling energy rings, the name   */
/*  staggers in letter by letter, then the tagline sweeps in before    */
/*  the whole intro crossfades into the app.                           */
/* ------------------------------------------------------------------ */

const NAME = 'KEA ENERGY';
const TAGLINE: { text: string; accent?: boolean; pipe?: boolean }[] = [
  { text: 'Understand' },
  { text: '|', pipe: true },
  { text: 'Track' },
  { text: '|', pipe: true },
  { text: 'Ask AI \u2013 Your Bill', accent: true },
];

const INTRO_MS = 2950;
const EXIT_MS = 480;

export function AppIntro({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const exit = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.55)).current;
  const ringPulse = useRef(new Animated.Value(0)).current;
  const dividerScale = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-width)).current;
  const tagShimmerX = useRef(new Animated.Value(-width)).current;
  const letters = useRef<Animated.Value[]>(NAME.split('').map(() => new Animated.Value(0))).current;
  const chunks = useRef<Animated.Value[]>(TAGLINE.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const anims: Animated.CompositeAnimation[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    // Logo mark: rises out of the black with a soft overshoot
    anims.push(
      Animated.parallel([
        Animated.timing(logoOpacity, { duration: 650, toValue: 1, useNativeDriver: true }),
        Animated.timing(logoScale, {
          duration: 1150,
          easing: Easing.out(Easing.back(1.35)),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    // Energy rings ripple outward twice while the mark lands
    anims.push(
      Animated.loop(
        Animated.sequence([
          Animated.timing(ringPulse, { duration: 1250, easing: Easing.out(Easing.ease), toValue: 1, useNativeDriver: true }),
          Animated.timing(ringPulse, { duration: 250, toValue: 0, useNativeDriver: true }),
        ]),
        { iterations: 2 },
      ),
    );
    anims.forEach((a) => a.start());

    // Name: letter-by-letter rise
    later(
      520,
      () =>
        Animated.stagger(
          55,
          letters.map((v: Animated.Value) =>
            Animated.timing(v, { duration: 430, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
          ),
        ).start(),
    );
    // Divider line sweeps open
    later(
      1450,
      () => Animated.timing(dividerScale, { duration: 480, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }).start(),
    );
    // Tagline: chunk-by-chunk drift up
    later(
      1580,
      () =>
        Animated.stagger(
          140,
          chunks.map((v: Animated.Value) =>
            Animated.timing(v, { duration: 520, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
          ),
        ).start(),
    );
    // Light sweep across the whole lockup
    later(2150, () => {
      shimmerX.setValue(-width);
      Animated.timing(shimmerX, { duration: 950, easing: Easing.inOut(Easing.ease), toValue: width * 1.25, useNativeDriver: true }).start();
    });
    // Tagline shimmer: a soft light keeps sweeping across the words
    const tagSweep = Animated.loop(
      Animated.sequence([
        Animated.timing(tagShimmerX, {
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          toValue: width + 120,
          useNativeDriver: true,
        }),
        Animated.delay(1300),
      ]),
    );
    anims.push(tagSweep);
    later(2100, () => tagSweep.start());
    // Crossfade into the app
    later(INTRO_MS, () => Animated.timing(exit, { duration: EXIT_MS, toValue: 0, useNativeDriver: true }).start());
    later(INTRO_MS + EXIT_MS + 80, onDone);

    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringScale = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.5] });
  const ringOpacity = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] });

  return (
    <View pointerEvents="auto" style={[introStyles.fill, { height, width }]}>
      <Animated.View style={[introStyles.stage, { opacity: exit }]}>
        {/* Logo lockup */}
        <View style={introStyles.logoWrap}>
          <Animated.View
            style={[
              introStyles.ring,
              { opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
          />
          <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
            <AnimatedLogo size={116} />
          </Animated.View>
        </View>

        {/* Company name, letter by letter */}
        <View style={introStyles.nameRow}>
          {letters.map((v: Animated.Value, i: number) => (
            <Animated.Text
              key={i}
              style={[
                introStyles.nameLetter,
                {
                  opacity: v,
                  transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
                },
              ]}
            >
              {NAME[i] === ' ' ? '\u00A0' : NAME[i]}
            </Animated.Text>
          ))}
        </View>

        {/* Divider sweep */}
        <Animated.View style={[introStyles.divider, { transform: [{ scaleX: dividerScale }] }]} />

        {/* Tagline */}
        <View style={introStyles.taglineClip}>
          <View style={introStyles.taglineRow}>
          {TAGLINE.map((c: { text: string; accent?: boolean; pipe?: boolean }, i: number) => (
            <Animated.Text
              key={i}
              style={[
                introStyles.tagline,
                c.pipe && introStyles.taglinePipe,
                c.accent && introStyles.taglineAccent,
                {
                  opacity: chunks[i],
                  transform: [{ translateY: chunks[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                },
              ]}
            >
              {c.text}
              </Animated.Text>
            ))}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[introStyles.tagShimmer, { transform: [{ translateX: tagShimmerX }, { rotate: '16deg' }] }]}
          />
        </View>

        {/* Light sweep */}
        <Animated.View
          pointerEvents="none"
          style={[introStyles.shimmer, { transform: [{ translateX: shimmerX }, { rotate: '16deg' }] }]}
        />
      </Animated.View>
    </View>
  );
}

const introStyles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: '#000000',
    elevation: 60,
    justifyContent: 'center',
    position: 'absolute',
    zIndex: 60,
  },
  stage: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  logoWrap: { alignItems: 'center', height: 200, justifyContent: 'center', width: 200 },
  ring: {
    borderColor: '#E8E8EC',
    borderRadius: 95,
    borderWidth: 1.5,
    height: 190,
    position: 'absolute',
    width: 190,
  },
  nameRow: { flexDirection: 'row', marginTop: 26 },
  nameLetter: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 7,
    textShadowColor: 'rgba(255,255,255,0.35)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 14,
  },
  divider: { backgroundColor: '#FFFFFF', height: 2, marginTop: 20, opacity: 0.85, width: 130 },
  taglineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    justifyContent: 'center',
    paddingHorizontal: 44,
  },
  tagShimmer: {
    backgroundColor: '#FFFFFF',
    height: '220%',
    opacity: 0.14,
    position: 'absolute',
    top: '-60%',
    width: 54,
  },
  taglineClip: { alignItems: 'center', marginTop: 16, overflow: 'hidden', paddingVertical: 8 },
  tagline: { color: '#C6C6CC', fontSize: 13.5, fontWeight: '600', letterSpacing: 1.6 },
  taglinePipe: { color: '#8E8E93', fontWeight: '800' },
  taglineAccent: { color: '#FFFFFF', fontWeight: '800' },
  shimmer: {
    backgroundColor: '#FFFFFF',
    height: '160%',
    opacity: 0.05,
    position: 'absolute',
    width: 90,
  },
});
