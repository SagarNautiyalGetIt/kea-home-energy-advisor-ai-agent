import { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Circle, Defs, G, Mask, Path } from 'react-native-svg';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useAppTheme } from '@/theme';
import { BotEngine } from '@/vendor/bloub/engine';
import { EXPRESSION_BY_ID } from '@/vendor/bloub/expressions';
import { DEMI_VIEWBOX, RAYON } from '@/vendor/bloub/repere';

type Mode = 'idle' | 'thinking' | 'replying' | 'happy' | 'static';

/** Unchanged Bloub body/eyes with a separate capsule-shaped mouth cutout. */
export function SparkyPresence({ size = 168, mode = 'idle' }: { size?: number; mode?: Mode }) {
  const { mode: themeMode, colors } = useAppTheme();
  const active = useActiveAnimation();
  const [reduceMotion, setReduceMotion] = useState(true);
  const engine = useRef(new BotEngine(RAYON, 'idle'));
  const time = useRef(0);
  const [frame, setFrame] = useState(() => engine.current.sample(0));
  const mask = 'bloub-' + useId().replace(/:/g, '');
  const ink = themeMode === 'dark' ? '#FFFFFF' : '#0A0A0C';

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    engine.current.setState(mode === 'thinking' ? 'thinking' : 'idle', time.current);
    engine.current.setExpression(EXPRESSION_BY_ID.get(mode === 'happy' ? 'heureux' : mode === 'replying' ? 'attentif' : 'neutre') ?? null, time.current);
    if (reduceMotion || mode === 'static' || !active) {
      setFrame(engine.current.sample(time.current + 0.5));
      return;
    }
    // Cap sampling at 30 fps and pause on hidden screens.
    const timer = setInterval(() => {
      time.current += 1 / 30;
      setFrame(engine.current.sample(time.current));
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, [active, mode, reduceMotion]);

  const mouth = mode === 'happy' ? 'M-18 30 Q0 48 18 30' : mode === 'thinking' ? 'M-8 36 L8 36' : mode === 'replying' ? 'M-9 31 Q0 25 9 31 L9 41 Q0 47 -9 41 Z' : 'M-13 34 Q0 39 13 34';
  const values = frame.eyes[0]?.matrix.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  const mouthTransform = values?.length === 6 ? `matrix(${values[0]},${values[1]},${values[2]},${values[3]},0,0)` : undefined;
  return <View accessibilityLabel={mode === 'thinking' ? 'Sparky AI is thinking' : mode === 'replying' ? 'Sparky AI is responding' : 'Sparky AI'} accessibilityRole="image" style={{ height: size, width: size }}>
    <Svg height={size} width={size} viewBox={`${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`}>
      <Defs><Mask id={mask} maskUnits="userSpaceOnUse" x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2}>
        <Path d={frame.bodyPath} fill="#FFFFFF" />
        {frame.eyes.map((eye, index) => <Path d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000000" key={index} />)}
        <Path d={mouth} transform={mouthTransform} opacity={frame.eyes[0]?.alpha ?? 0} fill={mode === 'replying' ? '#000000' : 'none'} stroke="#000000" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {frame.notch ? <Circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000000" /> : null}
      </Mask></Defs>
      {frame.arcs.map((arc) => <Path key={'back-' + arc.id} d={arc.back} stroke={ink} opacity={arc.opacity * 0.7} strokeWidth={arc.width} fill="none" strokeLinecap="round" />)}
      <G opacity={frame.bodyAlpha}><Path d={frame.bodyPath} fill={colors.background} /><Path d={frame.bodyPath} fill={ink} mask={`url(#${mask})`} /></G>
      {frame.arcs.map((arc) => <Path key={'front-' + arc.id} d={arc.front} stroke={ink} opacity={arc.opacity} strokeWidth={arc.width} fill="none" strokeLinecap="round" />)}
    </Svg>
  </View>;
}
