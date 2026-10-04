import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { useThree } from './gltf-canvas';

type Tick = (seconds: number) => void;
const Clock = createContext<Set<Tick> | null>(null);
/** One 30fps demand-render clock shared by weather and energy paths. */
export function HomeSceneMotion({ animated, children }: { animated: boolean; children: ReactNode }) {
  const callbacks = useRef(new Set<Tick>());
  const { invalidate } = useThree();
  useEffect(() => {
    if (!animated) { invalidate(); return; }
    const clock = { seconds: 0 }; let last = 0;
    const animation = gsap.to(clock, { seconds: 3600, duration: 3600, ease: 'none', repeat: -1, onUpdate: () => {
      const now = Date.now(); if (now - last < 33) return; last = now;
      callbacks.current.forEach(tick => tick(clock.seconds)); invalidate();
    } });
    return () => { animation.kill(); };
  }, [animated, invalidate]);
  return <Clock.Provider value={callbacks.current}>{children}</Clock.Provider>;
}
export function useHomeSceneTick(tick: Tick) {
  const callbacks = useContext(Clock);
  useEffect(() => { callbacks?.add(tick); return () => { callbacks?.delete(tick); }; }, [callbacks, tick]);
}
