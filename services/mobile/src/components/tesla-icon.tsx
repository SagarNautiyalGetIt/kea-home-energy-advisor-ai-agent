import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type TeslaIconName =
  | 'battery'
  | 'charge'
  | 'climate'
  | 'home'
  | 'solar'
  | 'car'
  | 'lock'
  | 'location'
  | 'sentry'
  | 'camera'
  | 'seat'
  | 'steering-wheel';

type Props = {
  name: TeslaIconName;
  size?: number;
  color?: string;
  active?: boolean;
};

const strokeWidth = 1.75;

export function TeslaIcon({ name, size = 24, color = '#8E8E8E', active = false }: Props) {
  const stroke = active ? color : color;
  const fill = active ? color : 'none';
  const common = { fill: 'none' as const, stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth };

  return (
    <Svg accessibilityLabel={`${name} icon`} height={size} viewBox="0 0 24 24" width={size}>
      {name === 'battery' ? <>
        <Rect {...common} height="11" rx="2" width="17" x="3" y="6.5" />
        <Line {...common} x1="21" x2="21" y1="10" y2="14" />
        <Path {...common} d="M7 12h5" />
        {active ? <Path d="M15 9.5v5" stroke={stroke} strokeLinecap="round" strokeWidth={strokeWidth} /> : null}
      </> : null}
      {name === 'charge' ? <>
        <Path {...common} d="M13 2 5.5 13h5l-.5 9L18.5 10h-5z" fill={fill} />
      </> : null}
      {name === 'climate' ? <>
        <Circle {...common} cx="12" cy="12" r="7" />
        <Path {...common} d="M12 5v14M5 12h14M7.05 7.05l9.9 9.9M16.95 7.05l-9.9 9.9" />
      </> : null}
      {name === 'home' ? <Path {...common} d="m3 11 9-7 9 7M5.5 9.5V20h13V9.5M9 20v-5h6v5" /> : null}
      {name === 'solar' ? <>
        <Circle {...common} cx="12" cy="12" r="3.5" />
        <Path {...common} d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </> : null}
      {name === 'car' ? <Path {...common} d="m5 16-1-4 2.5-5h11L20 12l-1 4M5 16v3h2v-2h10v2h2v-3M7 16h10M7 12h10" /> : null}
      {name === 'lock' ? <><Rect {...common} height="9" rx="1.5" width="13" x="5.5" y="10" /><Path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></> : null}
      {name === 'location' ? <><Path {...common} d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><Circle {...common} cx="12" cy="10" r="2" /></> : null}
      {name === 'sentry' ? <><Circle {...common} cx="12" cy="12" r="8" /><Circle {...common} cx="12" cy="12" r="3" /><Path {...common} d="M12 4v2M12 18v2M4 12h2M18 12h2" /></> : null}
      {name === 'camera' ? <><Rect {...common} height="11" rx="2" width="18" x="3" y="7" /><Path {...common} d="m8 7 1.5-2h5L16 7" /><Circle {...common} cx="12" cy="12.5" r="3" /></> : null}
      {name === 'seat' ? <Path {...common} d="M8 4h3l2 8h4a3 3 0 0 1 3 3v1H7a3 3 0 0 1-3-3v-1h5M7 16v4M18 16v4" /> : null}
      {name === 'steering-wheel' ? <><Circle {...common} cx="12" cy="12" r="8" /><Circle {...common} cx="12" cy="12" r="2" /><Path {...common} d="M4.5 10.5h5M14.5 10.5h5M12 14v6" /></> : null}
    </Svg>
  );
}
