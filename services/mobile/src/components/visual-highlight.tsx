import { useEffect } from 'react';
import { Platform } from 'react-native';
import { G, Path } from 'react-native-svg';
import Reanimated, { cancelAnimation, Easing, interpolate, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

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
export const HOME_OUTLINE: Record<HighlightTarget, string> = {
  solar: 'M968 250 L1362 92 L1558 266 L1146 425 Z',
  // The house is one silhouette: rear roof ridge, walls, then the left wing.
  // The old path drew a bright diagonal through the solar roof and front door.
  home: 'M302 368 L1366 50 L1716 356 L1706 666 L1180 869 L1180 828 L775 706 L654 758 L312 672 Z',
  // Trace the visible car body, including its low nose and rear shoulder.
  car: 'M689 916 C685 877 717 831 780 797 C838 766 900 755 946 757 C1000 756 1054 774 1076 799 C1093 823 1084 859 1068 885 C1059 914 1038 925 1018 930 L872 976 C815 987 742 972 702 942 Q688 932 689 916 Z',
  battery: 'M1243 680 L1314 654 L1315 785 L1244 812 Z',
  grid: 'M1762 592 L1851 556 L1900 577 L1900 677 L1804 715 L1762 697 Z',
};

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

export function VisualHighlight({ selected, active, reduceMotion }: { selected: HighlightTarget; active: boolean; reduceMotion: boolean }) {
  const pulse = useSharedValue(0);
  const animatedProps = useAnimatedProps(() => ({
    opacity: interpolate(pulse.value, [0, 0.45, 1], [0.38, 0.3, 0]),
    strokeWidth: interpolate(pulse.value, [0, 1], [10, 42]),
  }));

  useEffect(() => {
    cancelAnimation(pulse);
    pulse.set(0);
    if (!active || reduceMotion || Platform.OS === 'web') return;
    pulse.set(withRepeat(withTiming(1, { duration: 1850, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(pulse);
  }, [active, pulse, reduceMotion, selected]);

  const color = HIGHLIGHT_COLOR[selected];
  return <G>
    {active && !reduceMotion && Platform.OS !== 'web'
      ? <AnimatedPath animatedProps={animatedProps} d={HOME_OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      : <Path d={HOME_OUTLINE[selected]} fill="none" stroke={color} strokeOpacity={0.1} strokeWidth={12} />}
    <Path d={HOME_OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.18} strokeWidth={9} />
    <Path d={HOME_OUTLINE[selected]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.9} strokeWidth={3} />
  </G>;
}
