import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { gsap } from 'gsap';
import { CAMERA_LIMITS, constrainCamera, defaultCamera, type HomeCamera } from '@/lib/home-camera';
import { useAppTheme } from '@/theme';

/** Orbit changes the model camera; the rendered view itself stays in the screen plane. */
export function InteractiveHomeScene({ children, reduceMotion }: { children: (camera: HomeCamera) => ReactNode; reduceMotion: boolean }) {
  const { colors } = useAppTheme();
  const [camera, setCamera] = useState<HomeCamera>(defaultCamera);
  const current = useRef<HomeCamera>({ ...defaultCamera });
  const origin = useRef<HomeCamera>({ ...defaultCamera });
  const tween = useRef<ReturnType<typeof gsap.to> | null>(null);
  useEffect(() => () => { tween.current?.kill(); }, []);
  const move = (next: HomeCamera) => { tween.current?.kill(); current.current = constrainCamera(next); setCamera(current.current); };
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !reduceMotion && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { tween.current?.kill(); origin.current = { ...current.current }; },
    onPanResponderMove: (_, gesture) => move({ ...origin.current, x: origin.current.x + gesture.dx / 3, y: origin.current.y - gesture.dy / 8 }),
    onPanResponderTerminationRequest: () => true,
  }), [reduceMotion]);
  const reset = () => {
    tween.current?.kill();
    tween.current = gsap.to(current.current, { ...defaultCamera, duration: reduceMotion ? 0 : 0.4, ease: 'power3.out', onUpdate: () => setCamera({ ...current.current }) });
  };
  return <View style={{ position: 'relative', zIndex: 2 }}>
    <View {...responder.panHandlers}>{children(camera)}</View>
    <View style={{ backgroundColor: colors.background }}><View style={[styles.controls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.hint, { color: colors.textMuted }]}>{reduceMotion ? '3D home' : 'Drag to orbit'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Rotate home left" disabled={camera.x <= CAMERA_LIMITS.x[0]} onPress={() => move({ ...current.current, x: current.current.x - 12 })} style={styles.button}><Ionicons name="chevron-back" color={colors.text} size={18} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Rotate home right" disabled={camera.x >= CAMERA_LIMITS.x[1]} onPress={() => move({ ...current.current, x: current.current.x + 12 })} style={styles.button}><Ionicons name="chevron-forward" color={colors.text} size={18} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Raise home camera" disabled={camera.y >= CAMERA_LIMITS.y[1]} onPress={() => move({ ...current.current, y: current.current.y + 5 })} style={styles.button}><Ionicons name="chevron-up" color={colors.text} size={18} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom out home" disabled={camera.zoom <= 0.9} onPress={() => move({ ...current.current, zoom: current.current.zoom - 0.1 })} style={styles.button}><Ionicons name="remove" color={colors.text} size={20} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom in home" disabled={camera.zoom >= CAMERA_LIMITS.zoom[1]} onPress={() => move({ ...current.current, zoom: current.current.zoom + 0.1 })} style={styles.button}><Ionicons name="add" color={colors.text} size={20} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset home view" onPress={reset} style={styles.button}><Ionicons name="refresh-outline" color={colors.text} size={18} /></Pressable>
    </View></View>
  </View>;
}
const styles = StyleSheet.create({ controls: { alignItems: 'center', flexDirection: 'row', borderWidth: 1, borderRadius: 16, marginHorizontal: 16, marginTop: 5, paddingLeft: 12 }, hint: { flex: 1, fontSize: 11, paddingRight: 6 }, button: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44 } });
