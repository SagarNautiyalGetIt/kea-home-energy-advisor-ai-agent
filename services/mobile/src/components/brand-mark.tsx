import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { palette } from '@/theme';

export function BrandMark({ size = 44, light = false }: { size?: number; light?: boolean }) {
  const color = light ? '#FFFFFF' : palette.periwinkle;
  return (
    <Svg accessibilityLabel="Kea Energy" width={size} height={size} viewBox="0 0 256 256">
      <Defs>
        <LinearGradient id="bolt" x1="102" y1="61" x2="158" y2="197" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={light ? '#FFFFFF' : '#4318FF'} />
          <Stop offset="0.54" stopColor={light ? '#FFFFFF' : '#5F45FF'} />
          <Stop offset="1" stopColor={light ? '#FFFFFF' : '#868CFF'} />
        </LinearGradient>
      </Defs>
      <Path d="M33 128A95 95 0 0 1 208.6 77.6" stroke={color} strokeWidth={15} strokeLinecap="round" />
      <Path d="M226 96L222 68L197 85Z" fill={color} stroke={color} strokeWidth={5} strokeLinejoin="round" />
      <Path d="M223 128A95 95 0 0 1 47.4 178.4" stroke={color} strokeWidth={15} strokeLinecap="round" />
      <Path d="M30 160L34 188L59 171Z" fill={color} stroke={color} strokeWidth={5} strokeLinejoin="round" />
      <Path d="M143 54L137 110L166.5 119.4Q178 123 170.1 131.9L109 201L117 149L89 139.4Q79 136 87 125.8Z" fill="url(#bolt)" stroke="url(#bolt)" strokeWidth={3.5} strokeLinejoin="round" transform="translate(-12.8 -12.8) scale(1.1)" />
    </Svg>
  );
}
