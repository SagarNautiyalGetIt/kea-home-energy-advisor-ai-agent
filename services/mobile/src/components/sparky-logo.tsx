import { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import Animated, { Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const IMG_W = 1024;
const IMG_H = 800;
const COVER =
  'M549 276 L548 285 L535 295 L471 392 L460 402 L460 408 L447 420 L398 488 ' +
  'L401 505 L473 506 L451 638 L453 712 L487 653 L487 646 L493 645 L500 631 ' +
  'L506 628 L511 615 L517 612 L522 600 L528 597 L533 585 L632 451 L630 435 ' +
  'L561 433 L582 317 L582 276 Z';
const BOLT_BOUNDS = { x0: 380, y0: 252, x1: 650, y1: 735 };
const CHARGE_X = 515;

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The supplied neural-bolt artwork with a visual-only electrical charge reveal. */
export function SparkyLogo({ size = 120, drawDelayMs = 0 }: { size?: number; drawDelayMs?: number }) {
  const shouldDraw = size > 44;
  const charge = useSharedValue(shouldDraw ? 0 : 1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);
  useEffect(() => {
    if (reduceMotion || !shouldDraw) { charge.value = 1; return; }
    const timer = setTimeout(() => {
      charge.value = withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) });
    }, drawDelayMs);
    return () => clearTimeout(timer);
  }, [charge, drawDelayMs, reduceMotion, shouldDraw]);

  const clipProps = useAnimatedProps(() => {
    return { y: BOLT_BOUNDS.y0, height: Math.max(0.01, charge.value * (BOLT_BOUNDS.y1 - BOLT_BOUNDS.y0)) };
  });
  const chargeFrontProps = useAnimatedProps(() => ({ cy: BOLT_BOUNDS.y0 + charge.value * (BOLT_BOUNDS.y1 - BOLT_BOUNDS.y0), opacity: 1 - charge.value }));

  return <View style={[styles.wrap, { width: size, height: (size * IMG_H) / IMG_W }]}>
    <Image resizeMode="contain" source={require('../../assets/kea/sparky-brain-alpha.png')} style={styles.artwork} />
    <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${IMG_W} ${IMG_H}`}>
      <Defs>
        <Pattern height="11" id="neural-bolt-dots" patternUnits="userSpaceOnUse" width="11">
          <Circle cx="3" cy="3" fill="#FFFFFF" r="3.3" />
          <Circle cx="8.5" cy="8.5" fill="#DDF6FF" opacity={0.95} r="2.7" />
        </Pattern>
        <ClipPath id="neural-bolt-reveal"><AnimatedRect animatedProps={clipProps} height={shouldDraw ? 0.01 : BOLT_BOUNDS.y1 - BOLT_BOUNDS.y0} width={BOLT_BOUNDS.x1 - BOLT_BOUNDS.x0} x={BOLT_BOUNDS.x0} y={BOLT_BOUNDS.y0} /></ClipPath>
      </Defs>
      <G clipPath="url(#neural-bolt-reveal)"><Path d={COVER} fill="#BFEFFF" opacity={0.22} /><Path d={COVER} fill="url(#neural-bolt-dots)" /></G>
      <AnimatedCircle animatedProps={chargeFrontProps} cx={CHARGE_X} fill="#FFFFFF" r={13} />
    </Svg>
  </View>;
}

export function SparkyThinking({ bubbleStyle, textColor }: { bubbleStyle?: object; textColor?: string }) {
  const pulse = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);
  useEffect(() => { if (!reduceMotion) pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true); }, [pulse, reduceMotion]);
  const caretStyle = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.25, 1]) }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.55, 1]) }));
  return <View style={[styles.thinking, bubbleStyle]}><SparkyLogo size={30} /><Animated.Text style={[styles.thinkingText, { color: textColor }, labelStyle]}>Sparky is thinking</Animated.Text><Animated.View style={[styles.caret, caretStyle]} /></View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  artwork: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  thinking: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 10 },
  thinkingText: { fontSize: 14, fontWeight: '600' },
  caret: { width: 3, height: 15, borderRadius: 2, backgroundColor: '#FFFFFF', shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 6 },
});
