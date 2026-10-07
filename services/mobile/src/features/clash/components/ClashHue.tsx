import { CardHue } from '@/components/card-hue';
import { useAppTheme } from '@/theme';

/** Keep secondary copy readable even at the brightest point of the hue. */
export function ClashHue({ color }: { color: string }) {
  const { mode } = useAppTheme();
  return <CardHue color={color} opacity={mode === 'dark' ? 0.18 : 0.12} />;
}

/** Clash uses a stronger secondary tone on its coloured surfaces. */
export function useClashColors() {
  const { colors, mode } = useAppTheme();
  return { ...colors, textMuted: mode === 'dark' ? '#ABB6C2' : '#4B5563' };
}
