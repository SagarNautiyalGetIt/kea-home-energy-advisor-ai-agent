import { palette } from '@/theme';
import { Svg, Path } from 'react-native-svg';

export function WavyBorder() {
  return (
    <Svg
      height="80"
      width="100%"
      viewBox="0 0 1440 320"
      style={{ position: 'absolute', bottom: 0, zIndex: -1 }}
    >
      <Path
        fill={palette.white}
        d="M0,224L80,240C160,256,320,288,480,277.3C640,267,800,213,960,186.7C1120,160,1280,160,1360,160L1440,160L1440,320L1360,320C1280,320,1120,320,960,320C800,320,640,320,480,320C320,320,160,320,80,320L0,320Z"
      />
    </Svg>
  );
}