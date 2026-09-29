import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  runOnJS,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/* ------------------------------------------------------------------ */
/*  PaymentCard — a Visa card with the famous 3D flip. Tap to flip     */
/*  front/back, with a light shine sweeping across on every flip.       */
/* ------------------------------------------------------------------ */

type Props = { brand: string; last4: string; cardholder: string; expiry: string };

function Chip() {
  return (
    <Svg height={34} viewBox="0 0 44 34" width={44}>
      <Defs>
        <SvgGrad id="chip-gold" x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor="#F2F4F7" />
          <Stop offset={1} stopColor="#9AA0AA" />
        </SvgGrad>
      </Defs>
      <Rect fill="url(#chip-gold)" height={34} rx={6} width={44} />
      <Path
        d="M0 11 H13 V23 H0 M44 11 H31 V23 H44 M13 0 V34 M31 0 V34 M13 11 V23 M31 11 V23"
        fill="none"
        opacity={0.65}
        stroke="#6E747D"
        strokeWidth={1.2}
      />
      <Rect fill="none" height={32} rx={5} stroke="#6E747D" strokeOpacity={0.45} strokeWidth={1} width={42} x={1} y={1} />
    </Svg>
  );
}

function Contactless() {
  return (
    <Svg height={26} viewBox="0 0 26 26" width={26}>
      {[5.5, 9.5, 13.5].map((r) => {
        const x = 13 + r * 0.5;
        const dy = r * 0.866;
        return (
          <Path
            d={`M ${x} ${13 - dy} A ${r} ${r} 0 0 1 ${x} ${13 + dy}`}
            fill="none"
            key={r}
            stroke="#FFFFFF"
            strokeLinecap="round"
            strokeOpacity={0.85}
            strokeWidth={2.2}
          />
        );
      })}
    </Svg>
  );
}

export function PaymentCard({ brand, last4, cardholder, expiry }: Props) {
  const rot = useSharedValue(0);
  const shine = useSharedValue(0);
  const [flipped, setFlipped] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const runShine = () => {
    shine.value = 0;
    shine.value = withTiming(1, { duration: 1000, easing: Easing.out(Easing.cubic) });
  };

  useEffect(() => {
    if (reduceMotion) return;
    const flipBack = setTimeout(() => {
      setFlipped(true);
      rot.value = withTiming(180, { duration: 700, easing: Easing.inOut(Easing.ease) });
      runShine();
    }, 120);
    const returnFront = setTimeout(() => {
      setFlipped(false);
      rot.value = withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) });
      runShine();
    }, 1150);
    return () => { clearTimeout(flipBack); clearTimeout(returnFront); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const flip = () => {
    const next = !flipped;
    setFlipped(next);
    if (reduceMotion) {
      rot.value = next ? 180 : 0;
      return;
    }
    rot.value = withTiming(next ? 180 : 0, { duration: 650, easing: Easing.inOut(Easing.ease) });
    setTimeout(runShine, 250);
  };

  const swipeGesture = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-35, 35])
    .onEnd((event) => {
      if (Math.abs(event.translationY) > 35) runOnJS(flip)();
    });

  const frontStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rot.value, [0, 89, 91, 180], [1, 1, 0, 0]),
    transform: [{ perspective: 1100 }, { rotateX: `${rot.value}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rot.value, [0, 89, 91, 180], [0, 0, 1, 1]),
    transform: [{ perspective: 1100 }, { rotateX: `${rot.value + 180}deg` }],
  }));
  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
    transform: [{ translateX: interpolate(shine.value, [0, 1], [-260, 480]) }, { rotate: '18deg' }],
  }));

  const number = '••••  ••••  ••••  ••••';

  return (
    <View>
      <GestureDetector gesture={swipeGesture}>
      <View accessible accessibilityLabel={`${brand} card ending in ${last4}. Swipe up or down to flip.`} accessibilityRole="button" style={styles.cardWrap}>
          {/* FRONT */}
          <Animated.View style={[styles.face, frontStyle]}>
            <LinearGradient
              colors={['#26262B', '#0A0A0C']}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.deco1} />
            <View pointerEvents="none" style={styles.deco2} />
            <View style={styles.frontInner}>
              <View style={styles.frontTop}>
                <Chip />
                <Contactless />
              </View>
              <Text style={styles.number}>{number}</Text>
              <View style={styles.frontBottom}>
                <View>
                  <Text style={styles.label}>CARD HOLDER</Text>
                  <Text style={styles.value}>{cardholder.toUpperCase()}</Text>
                </View>
                <Text style={styles.visa}>VISA</Text>
              </View>
            </View>
          </Animated.View>

          {/* BACK */}
          <Animated.View style={[styles.face, backStyle]}>
            <LinearGradient
              colors={['#1B1B1F', '#08080A']}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.magStripe} />
            <View style={styles.backInner}>
              <View style={styles.backBrandRow}>
                <Text style={styles.keaLogo}>KEA</Text>
                <Text style={styles.visaBack}>VISA</Text>
              </View>
              <View style={styles.sigRow}>
                <View style={styles.sigStrip}>
                  <Text style={styles.sigText}>Authorized signature</Text>
                </View>
                <View style={styles.cvvBox}>
                  <Text style={styles.cvvLabel}>CVV</Text>
                  <Text style={styles.cvvValue}>•••</Text>
                </View>
              </View>
              <Text style={styles.finePrint}>
                This card is issued as a demo payment method. If found, please return it to Kea Energy.
              </Text>
            </View>
          </Animated.View>

          {/* shine sweep */}
          <Animated.View pointerEvents="none" style={[styles.shineWrap, shineStyle]}>
            <LinearGradient
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={styles.shine}
            />
          </Animated.View>
      </View>
      </GestureDetector>
      <Text style={{ marginTop: 6, textAlign: 'center', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#8E8E8E' }}>Sample</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    aspectRatio: 1.586,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: 'hidden' },
  deco1: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#FFFFFF',
    opacity: 0.06,
    top: -90,
    right: -60,
  },
  deco2: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#FFFFFF',
    opacity: 0.05,
    bottom: -70,
    left: -40,
  },
  frontInner: { flex: 1, justifyContent: 'space-between', padding: 20 },
  frontTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  number: { color: '#FFFFFF', fontSize: 19, fontWeight: '700', letterSpacing: 2.5 },
  frontBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  value: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 3, letterSpacing: 0.6 },
  visa: { color: '#3D6BFF', fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3 },
  visaSmall: { fontSize: 18, alignSelf: 'flex-end' },
  magStripe: { position: 'absolute', top: 22, left: 0, right: 0, height: 46, backgroundColor: '#0A0A0C' },
  backInner: { flex: 1, padding: 20, paddingTop: 84, justifyContent: 'space-between' },
  backBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keaLogo: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 5 },
  visaBack: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },
  sigRow: { flexDirection: 'row', gap: 10 },
  sigStrip: {
    flex: 1,
    height: 42,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sigText: { color: '#555', fontSize: 11, fontStyle: 'italic' },
  cvvBox: {
    width: 76,
    height: 42,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cvvLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cvvValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginTop: 1 },
  finePrint: { color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 16 },
  shineWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  shine: { width: 90, height: '220%' },
});
