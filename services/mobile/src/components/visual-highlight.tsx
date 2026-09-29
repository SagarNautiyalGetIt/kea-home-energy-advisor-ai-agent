import { useEffect } from 'react';
import { Platform } from 'react-native';
import { G, Path } from 'react-native-svg';
import Reanimated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

export type HighlightTarget = 'solar' | 'home' | 'car' | 'battery' | 'grid';

export const HIGHLIGHT_COLOR: Record<HighlightTarget, string> = {
  solar: '#63F09A',
  home: '#38BDF8',
  car: '#38BDF8',
  battery: '#5AB8FF',
  grid: '#FF9F43',
};

// These coordinates use the same 2048 × 1117.091 image viewBox as the live
// power paths. The halo identifies an object; it never represents a reading.
const OUTLINE: Record<HighlightTarget, string> = {
  solar: 'M968 250 L1362 92 L1558 266 L1146 425 Z',
  home: 'M301 368 L1368 50 L1716 352 L1716 665 L1164 867 L1138 555 L850 242 L301 368 Z',
  car: 'M690 929 C702 828 767 778 910 759 C1040 748 1110 814 1110 875 C1084 934 1011 967 852 984 C776 983 715 961 690 929 Z',
  battery: 'M1243 680 L1314 654 L1315 785 L1244 812 Z',
  grid: 'M1762 592 L1851 556 L1900 577 L1900 677 L1804 715 L1762 697 Z',
};

const AnimatedGroup = Reanimated.createAnimatedComponent(G);

export function VisualHighlight({ selected, active, reduceMotion }: { selected: HighlightTarget; active: boolean; reduceMotion: boolean }) {
  const glow = useSharedValue(0.45);
  const animatedProps = useAnimatedProps(() => ({ opacity: glow.value }));

  useEffect(() => {
    cancelAnimation(glow);
    glow.set(0.45);
    if (!active || reduceMotion || Platform.OS === 'web') return;
    glow.set(withRepeat(withTiming(0.82, { duration: 1450, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(glow);
  }, [active, glow, reduceMotion, selected]);

  const color = HIGHLIGHT_COLOR[selected];
  const mark = <>
    <Path d={OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.12} strokeWidth={34} />
    <Path d={OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.24} strokeWidth={15} />
    <Path d={OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.78} strokeWidth={4} />
  </>;

  return <>
    {active && !reduceMotion && Platform.OS !== 'web'
      ? <AnimatedGroup animatedProps={animatedProps}>{mark}</AnimatedGroup>
      : <G opacity={0.6}>{mark}</G>}
  </>;
}
