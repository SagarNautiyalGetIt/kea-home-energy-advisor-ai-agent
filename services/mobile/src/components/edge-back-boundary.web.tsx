import { useRef, type ReactNode } from 'react';
import { router, usePathname } from 'expo-router';
import { backFallback, canClaimEdgeBack, shouldCompleteEdgeBack } from '@/lib/edge-back';
import { tactile } from '@/lib/haptics';

/** Observe the edge on the existing wrapper; vertical scrolls keep their real target. */
export function EdgeBackBoundary({ children }: { children: ReactNode }) {
  const path = usePathname();
  const origin = useRef<{ x: number; clientX: number; y: number; time: number } | null>(null);
  const enabled = canClaimEdgeBack(path, 0, 30, 0);
  return <div style={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}
      onPointerDownCapture={event => { const x = event.clientX - event.currentTarget.getBoundingClientRect().left; origin.current = enabled && x >= 0 && x <= 24 ? { x, clientX: event.clientX, y: event.clientY, time: Date.now() } : null; }}
      onPointerCancel={() => { origin.current = null; }}
      onPointerMoveCapture={event => { const start = origin.current; if (start && canClaimEdgeBack(path, start.x, event.clientX - start.clientX, event.clientY - start.y)) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); } }}
      onPointerUpCapture={event => {
        const start = origin.current; origin.current = null;
        if (!start) return;
        const dx = event.clientX - start.clientX, dy = event.clientY - start.y;
        if (!canClaimEdgeBack(path, start.x, dx, dy) || !shouldCompleteEdgeBack(dx, dy, dx / Math.max(1, Date.now() - start.time))) return;
        tactile(); if (router.canGoBack()) router.back(); else router.replace(backFallback(path));
      }}>
    {children}
  </div>;
}
