import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { AURORA_COLORS, auroraRibbon } from '@/lib/aurora-ribbon';
import { useAuroraTime } from './aurora-motion';
import { useAppTheme } from '@/theme';

/** Native SVG adaptation of React Bits Aurora's colour ramp and flowing curtain. */
export function AuroraBackground() {
  const { mode } = useAppTheme();
  const time = useAuroraTime();
  const id = 'aurora-' + useId().replace(/:/g, '');
  return <View accessible={false} pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', opacity: mode === 'dark' ? 0.42 : 0.2 }]}>
    <Svg height="100%" width="100%" viewBox="0 0 400 800" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id + '-ramp'} x1="0" y1="0" x2="1" y2="0">{AURORA_COLORS.map((color, i) => <Stop key={i} offset={i / 2} stopColor={color} />)}</LinearGradient>
        <LinearGradient id={id + '-fade'} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={mode === 'dark' ? '#111111' : '#EEEEEE'} stopOpacity="0" /><Stop offset="0.65" stopColor={mode === 'dark' ? '#111111' : '#EEEEEE'} /></LinearGradient>
      </Defs>
      <Path d={auroraRibbon(time, 0)} fill={`url(#${id}-ramp)`} opacity={0.5} />
      <Path d={auroraRibbon(time, 1.5)} fill={`url(#${id}-ramp)`} opacity={0.3} transform="translate(0 65)" />
      <Path d="M0 0H400V800H0Z" fill={`url(#${id}-fade)`} />
    </Svg>
  </View>;
}
