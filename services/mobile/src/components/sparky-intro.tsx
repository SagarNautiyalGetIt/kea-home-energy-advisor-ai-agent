import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SparkyLogo } from './sparky-logo';

const DURATION = 5000;

export function SparkyIntro({ onDone }: { onDone: () => void }) {
  const progress = useSharedValue(0); const [reduceMotion, setReduceMotion] = useState(false); const finished = useRef(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);
  useEffect(() => { progress.value = withTiming(1, { duration: reduceMotion ? 350 : DURATION, easing: Easing.inOut(Easing.cubic) }); const timer = setTimeout(() => { if (!finished.current) { finished.current = true; onDone(); } }, reduceMotion ? 450 : DURATION + 150); return () => clearTimeout(timer); }, [onDone, progress, reduceMotion]);
  const camera = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.08]) }] }));
  const bloom = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, .18, .42, 1], [0, .9, .25, .38]), transform: [{ scale: interpolate(progress.value, [0, .35, 1], [.2, 1.2, 1.45]) }] }));
  const mark = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [.28, .52], [0, 1]), transform: [{ translateY: interpolate(progress.value, [.28, .55], [34, 0]) }, { scale: interpolate(progress.value, [.28, .55], [.7, 1]) }] }));
  const title = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [.48, .7], [0, 1]), transform: [{ translateY: interpolate(progress.value, [.48, .7], [18, 0]) }] }));
  const tag = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [.66, .84], [0, 1]) }));
  return <Pressable onPress={() => { if (!finished.current) { finished.current = true; onDone(); } }} style={styles.stage}><Animated.View style={[styles.fill, camera]}><Animated.View style={[styles.center, bloom]}><Svg height={250} viewBox="0 0 200 200" width={250}><Defs><LinearGradient id="silver" x1="0" x2="1" y1="0" y2="1"><Stop offset="0" stopColor="#FFF" stopOpacity=".45" /><Stop offset=".5" stopColor="#8D929A" stopOpacity=".14" /><Stop offset="1" stopColor="#FFF" stopOpacity="0" /></LinearGradient></Defs><Circle cx="100" cy="100" fill="url(#silver)" r="100" /></Svg></Animated.View><View style={styles.lockup}><Animated.View style={mark}><SparkyLogo size={128} /></Animated.View><Animated.Text style={[styles.title, title]}>SPARKY AI</Animated.Text><Animated.Text style={[styles.tag, tag]}>YOUR ENERGY, UNDERSTOOD</Animated.Text></View></Animated.View></Pressable>;
}

const styles = StyleSheet.create({ stage: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' }, fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }, lockup: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }, title: { marginTop: 22, color: '#FFF', fontSize: 31, fontWeight: '900', letterSpacing: 6, textShadowColor: '#FFF', textShadowRadius: 14 }, tag: { marginTop: 12, color: '#A3A6AD', fontSize: 12, fontWeight: '700', letterSpacing: 3.5 } });
