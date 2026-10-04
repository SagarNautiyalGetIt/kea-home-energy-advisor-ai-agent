import { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Stop } from 'react-native-svg';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useAppTheme } from '@/theme';
import { mouthPose, mouthShape, type MouthMode } from '@/lib/sparky-mouth';
import { sparkyFace, sparkyReactionForTap, type SparkyReaction } from '@/lib/sparky-reaction';
import { tactile } from '@/lib/haptics';
import { BotEngine } from '@/vendor/bloub/engine';
import { EXPRESSION_BY_ID } from '@/vendor/bloub/expressions';
import { DEMI_VIEWBOX, RAYON } from '@/vendor/bloub/repere';
import { AURORA_COLORS, auroraRibbon } from '@/lib/aurora-ribbon';
import { useAuroraTime } from './aurora-motion';

type Mode = MouthMode;

/** Unchanged Bloub body/eyes with a separate capsule-shaped mouth cutout. */
export function SparkyPresence({ size = 168, mode = 'idle', auroraTint = false, interactive = false }: { size?: number; mode?: Mode; auroraTint?: boolean; interactive?: boolean }) {
  const { mode: themeMode, colors } = useAppTheme();
  const active = useActiveAnimation();
  const auroraTime = useAuroraTime();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [engine] = useState(() => {
    const bot = new BotEngine(RAYON, 'idle');
    bot.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 0 }, -1);
    return bot;
  });
  const time = useRef(0);
  const [frame, setFrame] = useState(() => engine.sample(0));
  const [reaction, setReaction] = useState<SparkyReaction>();
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taps = useRef(0);
  const lastTap = useRef(0);
  const mask = 'bloub-' + useId().replace(/:/g, '');
  const ink = themeMode === 'dark' ? '#FFFFFF' : '#0A0A0C';
  const face = sparkyFace(mode, reaction, reduceMotion);
  const statusLabel = mode === 'thinking' ? 'Sparky AI is thinking' : mode === 'replying' ? 'Sparky AI is responding' : 'Sparky AI';

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (!cancelled) setReduceMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { cancelled = true; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!active) {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = null;
      setReaction(undefined);
    }
    return () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = null;
    };
  }, [active]);

  const reactToTap = () => {
    // Bound rapid taps and haptics; the original engine blends an interrupted reaction.
    if (!active || Date.now() - lastTap.current < 250) return;
    lastTap.current = Date.now();
    const next = sparkyReactionForTap(taps.current++);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    setReaction(next);
    tactile();
    reactionTimer.current = setTimeout(() => {
      reactionTimer.current = null;
      setReaction(undefined);
    }, next.durationMs);
  };

  useEffect(() => {
    const nextFace = sparkyFace(mode, reaction, reduceMotion);
    engine.setState(nextFace.state, time.current);
    engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: reduceMotion ? 0 : 0.12 }, time.current);
    engine.setExpression(EXPRESSION_BY_ID.get(nextFace.expression) ?? null, time.current);
    if (reduceMotion || !active || mode === 'static') {
      setFrame(engine.sample(time.current + 0.5));
      return;
    }
    // Cap sampling at 30 fps and pause on hidden screens.
    const timer = setInterval(() => {
      time.current += 1 / 30;
      if (!reaction && mode === 'idle' && Math.floor(time.current * 30) % 240 === 0) {
        const expression = Math.floor(time.current / 8) % 2 ? 'heureux' : 'neutre';
        engine.setExpression(EXPRESSION_BY_ID.get(expression) ?? null, time.current);
      }
      setFrame(engine.sample(time.current));
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, [active, engine, mode, reaction, reduceMotion]);

  const mouth = mouthShape(face.mouth, time.current, !reduceMotion && active);
  const mouthTransform = mouthPose(frame.eyes);
  const artwork = <View accessible={!interactive} accessibilityElementsHidden={interactive} accessibilityLabel={statusLabel} accessibilityRole="image" importantForAccessibility={interactive ? 'no-hide-descendants' : 'auto'} style={{ height: size, width: size }}>
    <Svg height={size} width={size} viewBox={`${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`}>
      <Defs><Mask id={mask} maskUnits="userSpaceOnUse" x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2}>
        <Path d={frame.bodyPath} fill="#FFFFFF" />
        {frame.eyes.map((eye, index) => <Path d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000000" key={index} />)}
        <Path d={mouth.d} transform={mouthTransform} fill={mouth.fill ? '#000000' : 'none'} stroke="#000000" strokeWidth={mouth.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        {frame.notch ? <Circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000000" /> : null}
      </Mask>
      {auroraTint ? <>
        <LinearGradient id={mask + '-hue'} gradientUnits="userSpaceOnUse" x1={-DEMI_VIEWBOX} y1={0} x2={DEMI_VIEWBOX} y2={0}>{AURORA_COLORS.map((color, i) => <Stop key={i} offset={i / 2} stopColor={color} />)}</LinearGradient>
        <LinearGradient id={mask + '-curtain'} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={400} y2={0}>{AURORA_COLORS.map((color, i) => <Stop key={i} offset={i / 2} stopColor={color} />)}</LinearGradient>
      </> : null}
      </Defs>
      {frame.arcs.map((arc) => <Path key={'back-' + arc.id} d={arc.back} stroke={ink} opacity={arc.opacity * 0.7} strokeWidth={arc.width} fill="none" strokeLinecap="round" />)}
      <G opacity={frame.bodyAlpha}>
        <Path d={frame.bodyPath} fill={colors.background} /><Path d={frame.bodyPath} fill={ink} mask={`url(#${mask})`} />
        {auroraTint ? <G mask={`url(#${mask})`} opacity={themeMode === 'dark' ? 0.085 : 0.075} pointerEvents="none">
          <Path d={frame.bodyPath} fill={`url(#${mask}-hue)`} opacity={0.45} />
          <G transform={`translate(${-DEMI_VIEWBOX} -100) scale(${DEMI_VIEWBOX * 2 / 400})`}>
            <Path d={auroraRibbon(auroraTime, 0)} fill={`url(#${mask}-curtain)`} opacity={0.6} />
            <Path d={auroraRibbon(auroraTime, 1.5)} fill={`url(#${mask}-curtain)`} opacity={0.35} transform="translate(0 65)" />
          </G>
        </G> : null}
      </G>
      {frame.arcs.map((arc) => <Path key={'front-' + arc.id} d={arc.front} stroke={ink} opacity={arc.opacity} strokeWidth={arc.width} fill="none" strokeLinecap="round" />)}
    </Svg>
  </View>;
  return interactive ? <Pressable accessibilityRole="button" accessibilityLabel={`${statusLabel}${face.reactionLabel ? `, ${face.reactionLabel}` : ''}`} accessibilityHint="Tap to see Sparky wink, smile or look curious" onPress={reactToTap} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>{artwork}</Pressable> : artwork;
}
