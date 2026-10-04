import { useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { backFallback, canClaimEdgeBack, shouldCompleteEdgeBack } from '@/lib/edge-back';
import { tactile } from '@/lib/haptics';

/** Start-edge ownership leaves charts, scene orbit and horizontal rails alone. */
export function EdgeBackBoundary({ children }: { children: ReactNode }) {
  const path = usePathname();
  const startX = useRef(-1);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: event => { startX.current = event.nativeEvent.pageX; return false; },
    onMoveShouldSetPanResponderCapture: (_, gesture) => canClaimEdgeBack(path, startX.current, gesture.dx, gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      if (!shouldCompleteEdgeBack(gesture.dx, gesture.dy, gesture.vx)) return;
      tactile();
      if (router.canGoBack()) router.back(); else router.replace(backFallback(path));
    },
    onPanResponderTerminationRequest: () => true,
  }), [path]);
  return <View style={{ flex: 1 }} {...responder.panHandlers}>{children}</View>;
}
