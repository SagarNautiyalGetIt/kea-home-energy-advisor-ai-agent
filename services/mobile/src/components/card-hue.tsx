import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { auroraRibbon } from '@/lib/aurora-ribbon';
import { useAuroraTime } from './aurora-motion';
import { useAppTheme } from '@/theme';

/** A lightweight card adaptation of the shared React Bits Aurora reference. */
export function CardHue({ color }: { color: string }) {
  const time = useAuroraTime(), id = 'hue-' + useId().replace(/:/g, '');
  const { mode } = useAppTheme();
  return <View accessible={false} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: mode === 'dark' ? 0.22 : 0.14, overflow: 'hidden' }]}>
    <Svg width="100%" height="100%" viewBox="0 0 400 350" preserveAspectRatio="none"><Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={color} stopOpacity="0" /><Stop offset="0.6" stopColor={color} /><Stop offset="1" stopColor={color} stopOpacity="0.15" /></LinearGradient></Defs><Path d={auroraRibbon(time, 0)} fill={`url(#${id})`} /><Path d={auroraRibbon(time, 1.5)} transform="translate(0 75)" fill={`url(#${id})`} opacity={0.65} /></Svg>
  </View>;
}
