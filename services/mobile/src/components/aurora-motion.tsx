import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { gsap } from 'gsap';
import { useActiveAnimation } from '@/lib/use-active-animation';

const AuroraTime = createContext(0);
export const useAuroraTime = () => useContext(AuroraTime);

/** One clock keeps the background and Bloub reflection in phase. */
export function AuroraMotion({ children }: { children: ReactNode }) {
  const active = useActiveAnimation();
  const [reduced, setReduced] = useState(true);
  const [time, setTime] = useState(0);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active || reduced) return;
    const clock = { time: 0 };
    let last = 0;
    const tween = gsap.to(clock, { time: Math.PI * 2, duration: 24, repeat: -1, ease: 'none', onUpdate: () => {
      const now = Date.now();
      if (now - last >= 33) { last = now; setTime(clock.time); }
    } });
    return () => { tween.kill(); };
  }, [active, reduced]);
  return <AuroraTime.Provider value={time}>{children}</AuroraTime.Provider>;
}
