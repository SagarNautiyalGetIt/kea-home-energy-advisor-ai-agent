import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, View } from 'react-native';
import { gsap } from 'gsap';
import { dragHomeCamera, defaultCamera, type HomeCamera } from '@/lib/home-camera';
import { appendHomeCameraReveal, appendHomeMaterial } from '@/lib/home-reveal';
import { useActiveAnimation } from '@/lib/use-active-animation';

/** Claim scene touches before the enclosing native ScrollView can take them. */
export function InteractiveHomeScene({ children, reduceMotion, pinnedHolographic = false, onInteractionChange }: { children: (camera: HomeCamera, onReady: () => void, holographicMix: number) => ReactNode; reduceMotion: boolean; pinnedHolographic?: boolean; onInteractionChange?: (locked: boolean) => void }) {
  const [camera, setCamera] = useState<HomeCamera>(defaultCamera);
  const [mix, setMix] = useState(reduceMotion && !pinnedHolographic ? 0 : 1);
  const [ready, setReady] = useState(false);
  const active = useActiveAnimation();
  const activeRef = useRef(active);
  const lastFrame = useRef(0);
  const current = useRef({ ...defaultCamera, mix: 1 });
  const origin = useRef<HomeCamera>({ ...defaultCamera });
  const timeline = useRef<ReturnType<typeof gsap.timeline> | null>(null);
  const touched = useRef(false);
  const revealed = useRef(false);
  const publish = useCallback((force = false) => {
    const now = Date.now(); if (!force && now - lastFrame.current < 33) return;
    lastFrame.current = now; setCamera({ ...current.current }); setMix(current.current.mix);
  }, []);
  const onReady = useCallback(() => setReady(true), []);
  const finishStyle = useCallback((animation: ReturnType<typeof gsap.timeline>) => {
    appendHomeMaterial(animation, current.current, publish, pinnedHolographic, reduceMotion);
  }, [pinnedHolographic, reduceMotion, publish]);
  useEffect(() => {
    if (!ready) return;
    if (reduceMotion) {
      timeline.current?.kill();
      Object.assign(current.current, defaultCamera, { focusX: 0, focusY: 0, focusZ: 0, mix: pinnedHolographic ? 1 : 0 });
      publish(true); return;
    }
    if (touched.current || revealed.current) {
      const animation = gsap.timeline({ paused: !activeRef.current }); timeline.current?.kill(); timeline.current = animation; finishStyle(animation);
      return () => { animation.kill(); };
    }
    revealed.current = true;
    Object.assign(current.current, { ...defaultCamera, mix: 1, zoom: 2.05, focusX: 0.3, focusY: -0.14, focusZ: 0.45 });
    publish(true);
    const context = gsap.context(() => {
      const animation = gsap.timeline({ paused: !activeRef.current }); timeline.current = animation;
      appendHomeCameraReveal(animation, current.current, publish);
      finishStyle(animation);
    });
    return () => { context.revert(); if (!touched.current) revealed.current = false; };
  }, [ready, reduceMotion, pinnedHolographic, publish, finishStyle]);
  useEffect(() => { activeRef.current = active; if (active) timeline.current?.resume(); else { timeline.current?.pause(); onInteractionChange?.(false); } }, [active, ready, onInteractionChange]);
  useEffect(() => () => { timeline.current?.kill(); onInteractionChange?.(false); }, [onInteractionChange]);
  const settle = useCallback(() => {
    onInteractionChange?.(false);
    timeline.current?.kill();
    const animation = gsap.timeline({ paused: !activeRef.current }); timeline.current = animation;
    if (current.current.zoom > 1.18 || current.current.focusX || current.current.focusY || current.current.focusZ) {
      animation.to(current.current, { zoom: 1, focusX: 0, focusY: 0, focusZ: 0, duration: reduceMotion ? 0 : 1.2, ease: 'power2.out', onUpdate: () => publish(), onComplete: () => publish(true) });
    }
    finishStyle(animation);
  }, [reduceMotion, finishStyle, publish, onInteractionChange]);
  const move = useCallback((next: HomeCamera) => { touched.current = true; timeline.current?.kill(); Object.assign(current.current, dragHomeCamera(next, 0, 0)); publish(); settle(); }, [publish, settle]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { onInteractionChange?.(true); touched.current = true; timeline.current?.kill(); origin.current = { ...current.current }; },
    onPanResponderMove: (_, gesture) => { Object.assign(current.current, dragHomeCamera(origin.current, gesture.dx, gesture.dy)); publish(); },
    onPanResponderRelease: settle,
    onPanResponderTerminate: settle,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [settle, publish, onInteractionChange]);
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Explore your 3D home" accessibilityHint="Drag horizontally or vertically to orbit. Accessibility actions rotate or reset the camera." accessibilityActions={[{ name: 'increment', label: 'Rotate right' }, { name: 'decrement', label: 'Rotate left' }, { name: 'raise', label: 'Raise camera' }, { name: 'lower', label: 'Lower camera' }, { name: 'activate', label: 'Reset view' }]} onAccessibilityAction={({ nativeEvent }) => {
    const action = nativeEvent.actionName;
    move(action === 'activate' ? defaultCamera : { ...current.current, x: current.current.x + (action === 'increment' ? 12 : action === 'decrement' ? -12 : 0), y: current.current.y + (action === 'raise' ? 5 : action === 'lower' ? -5 : 0) });
  }} style={{ position: 'relative' }}>{children(camera, onReady, mix)}</View>;
}
