import { memo, useEffect, useMemo, useState } from 'react';
import Svg, { Defs, Ellipse, RadialGradient, Stop, Polygon } from 'react-native-svg';
import { gsap } from 'gsap';
import type { HomeCamera } from '@/lib/home-camera';
import { projectHome, type HomePart, type ProjectedFace } from '@/lib/home-model';
import { HIGHLIGHT_COLOR } from './visual-highlight';

export type HomeFlow = { id: Exclude<HomePart, 'home'>; reverse: boolean; watts: number };

const Surface = memo(function Surface({ face, selected, onSelect, fill }: {face: ProjectedFace; selected: HomePart; onSelect: (part: HomePart) => void; fill: string}) {
  const envelope = /^(main|wing)-(front|back|left|right|gable-front|gable-back|roof-left|roof-right)(~[fb])*$/.test(face.id);
  const highlighted = face.flowProgress === undefined && face.part === selected && (selected !== 'home' || envelope);
  return <Polygon accessible={false} aria-hidden points={face.points} fill={fill} stroke={highlighted ? HIGHLIGHT_COLOR[selected] : '#162737'} strokeOpacity={highlighted ? 0.95 : 0.18} strokeWidth={highlighted ? 2.7 : 0.55} strokeLinejoin="round" onPress={face.part && face.flowProgress === undefined ? () => onSelect(face.part!) : undefined} pointerEvents={face.flowProgress === undefined ? 'auto' : 'none'} />;
});

export function HomeModelScene({ camera, width, height, selected, onSelect, flows, animate }: {
  camera: HomeCamera; width: number; height: number; selected: HomePart;
  onSelect: (part: HomePart) => void; flows: HomeFlow[]; animate: boolean;
}) {
  const [time, setTime] = useState(0);
  const geometry = useMemo(() => projectHome(camera), [camera]);
  useEffect(() => {
    if (!animate || flows.length === 0) return;
    let previous = -1;
    const tick = (seconds: number) => {
      const frame = Math.floor(seconds * 20);
      if (frame !== previous) { previous = frame; setTime(seconds); }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [animate, flows.length]);
  return <Svg width={width} height={height} viewBox="0 0 1000 700" accessible accessibilityRole="image" accessibilityLabel="Interactive 3D energy home">
    <Defs><RadialGradient id="home-ground-shadow" cx="50%" cy="50%" rx="50%" ry="50%"><Stop offset="0" stopColor="#07101c" stopOpacity={0.42} /><Stop offset="1" stopColor="#07101c" stopOpacity={0} /></RadialGradient></Defs>
    <Ellipse accessible={false} aria-hidden cx="520" cy="515" rx={365*camera.zoom} ry={112*camera.zoom} fill="url(#home-ground-shadow)" pointerEvents="none" />
    {geometry.map(face => {
      const flow = face.flowProgress === undefined ? undefined : flows.find(flow => flow.id === face.part);
      const phase = flow ? ((face.flowProgress! + (flow.reverse ? 1 : -1)*time/(Math.max(1.9,3.2-Math.min(flow.watts/1000,6)*0.17))) % 0.33+0.33)%0.33 : 1;
      const bright = animate && flow && phase < 0.06;
      const fill = flow ? (bright ? '#eefcf7' : HIGHLIGHT_COLOR[flow.id]) : face.fill;
      return <Surface key={face.id} face={face} selected={selected} onSelect={onSelect} fill={fill} />;
    })}
  </Svg>;
}
