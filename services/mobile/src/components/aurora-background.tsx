import { useEffect, useId, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { gsap } from 'gsap';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useAppTheme } from '@/theme';

/** Native SVG adaptation of React Bits Aurora's colour ramp and flowing curtain. */
export function AuroraBackground() {
  const { mode } = useAppTheme();
  const active = useActiveAnimation();
  const id = 'aurora-' + useId().replace(/:/g, '');
  const [reduced, setReduced] = useState(true);
  const [time, setTime] = useState(0);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active || reduced) return;
    const clock = { time: 0 };
    let last = 0;
    const tween = gsap.to(clock, { time: Math.PI * 2, duration: 24, repeat: -1, ease: 'none', onUpdate: () => {
      const now = Date.now();
      if (now - last >= 33) { last = now; setTime(clock.time); }
    } });
    return () => { tween.kill(); };
  }, [active, reduced]);
  const ribbon = (phase: number) => {
    const points = Array.from({ length: 33 }, (_, i) => {
      const x = i * 12.5;
      const y = 105 + 40 * Math.sin(i / 7 + time + phase) + 16 * Math.sin(i / 3 - time + phase);
      return `${x},${y}`;
    });
    return `M0,-20 L400,-20 L${points.reverse().join(' L')} Z`;
  };
  return <View accessible={false} pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', opacity: mode === 'dark' ? 0.42 : 0.2 }]}>
    <Svg height="100%" width="100%" viewBox="0 0 400 800" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id + '-ramp'} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#5227FF" /><Stop offset="0.5" stopColor="#7CFF67" /><Stop offset="1" stopColor="#5227FF" /></LinearGradient>
        <LinearGradient id={id + '-fade'} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={mode === 'dark' ? '#111111' : '#EEEEEE'} stopOpacity="0" /><Stop offset="0.65" stopColor={mode === 'dark' ? '#111111' : '#EEEEEE'} /></LinearGradient>
      </Defs>
      <Path d={ribbon(0)} fill={`url(#${id}-ramp)`} opacity={0.5} />
      <Path d={ribbon(1.5)} fill={`url(#${id}-ramp)`} opacity={0.3} transform="translate(0 65)" />
      <Path d="M0 0H400V800H0Z" fill={`url(#${id}-fade)`} />
    </Svg>
  </View>;
}
