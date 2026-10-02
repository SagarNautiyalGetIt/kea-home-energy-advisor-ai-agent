import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, View } from 'react-native';
import { gsap } from 'gsap';
import { dragHomeCamera, defaultCamera, type HomeCamera } from '@/lib/home-camera';

/** Scene-local gestures leave cards and the navigation sheet free to scroll. */
export function InteractiveHomeScene({ children, reduceMotion }: { children: (camera: HomeCamera, onReady: () => void) => ReactNode; reduceMotion: boolean }) {
  const [camera, setCamera] = useState<HomeCamera>(defaultCamera);
  const [ready, setReady] = useState(false);
  const current = useRef<HomeCamera>({ ...defaultCamera });
  const origin = useRef<HomeCamera>({ ...defaultCamera });
  const tween = useRef<ReturnType<typeof gsap.to> | null>(null);
  const touched = useRef(false);
  const revealed = useRef(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (reduceMotion) { tween.current?.kill(); current.current = { ...defaultCamera }; setCamera(defaultCamera); return; }
    if (!ready || touched.current || revealed.current) return;
    revealed.current = true;
    Object.assign(current.current, { ...defaultCamera, zoom: 2.05, focusX: 0.3, focusY: -0.14, focusZ: 0.45 });
    setCamera({ ...current.current });
    const context = gsap.context(() => {
      tween.current = gsap.to(current.current, { ...defaultCamera, focusX: 0, focusY: 0, focusZ: 0, delay: 0.45, duration: 3.8, ease: 'power2.inOut', onUpdate: () => setCamera({ ...current.current }) });
    });
    return () => { context.revert(); if (!touched.current) revealed.current = false; };
  }, [ready, reduceMotion]);
  useEffect(() => () => { tween.current?.kill(); }, []);
  const move = useCallback((next: HomeCamera) => { touched.current = true; tween.current?.kill(); current.current = dragHomeCamera(next, 0, 0); setCamera(current.current); }, []);
  const settle = useCallback(() => {
    if (current.current.zoom <= 1.18 && !current.current.focusX && !current.current.focusY && !current.current.focusZ) return;
    tween.current = gsap.to(current.current, { zoom: 1, focusX: 0, focusY: 0, focusZ: 0, duration: reduceMotion ? 0 : 1.2, ease: 'power2.out', onUpdate: () => setCamera({ ...current.current }) });
  }, [reduceMotion]);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 8,
    onPanResponderGrant: () => { touched.current = true; tween.current?.kill(); origin.current = { ...current.current }; },
    onPanResponderMove: (_, gesture) => { current.current = dragHomeCamera(origin.current, gesture.dx, gesture.dy); setCamera({ ...current.current }); },
    onPanResponderRelease: settle,
    onPanResponderTerminate: settle,
    onPanResponderTerminationRequest: () => false,
  }), [settle]);
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Explore your 3D home" accessibilityHint="Drag horizontally or vertically to orbit. Accessibility actions rotate or reset the camera." accessibilityActions={[{ name: 'increment', label: 'Rotate right' }, { name: 'decrement', label: 'Rotate left' }, { name: 'raise', label: 'Raise camera' }, { name: 'lower', label: 'Lower camera' }, { name: 'activate', label: 'Reset view' }]} onAccessibilityAction={({ nativeEvent }) => {
    const action = nativeEvent.actionName;
    move(action === 'activate' ? defaultCamera : { ...current.current, x: current.current.x + (action === 'increment' ? 12 : action === 'decrement' ? -12 : 0), y: current.current.y + (action === 'raise' ? 5 : action === 'lower' ? -5 : 0) });
    if (action !== 'activate') settle();
  }} style={{ position: 'relative' }}>{children(camera, onReady)}</View>;
}
