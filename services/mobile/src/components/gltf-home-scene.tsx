/* React Three Fiber supplies the scene intrinsics. */
/* eslint-disable react/no-unknown-property */
import { Asset } from 'expo-asset';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { gsap } from 'gsap';
import { BackSide, Box3, CatmullRomCurve3, Color, DoubleSide, Mesh, MeshBasicMaterial, ShaderMaterial, TubeGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Canvas, useLoader, useThree } from './gltf-canvas';
import type { HomeCamera } from '@/lib/home-camera';
import { HOME_MODEL_ASSET } from '@/lib/home-model-asset';
import type { HomeFlow } from '@/lib/home-flows';
import type { AucklandWeather } from '@/lib/auckland-weather';
import { HIGHLIGHT_COLOR, type HighlightTarget } from './visual-highlight';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useExperience } from '@/lib/experience-preferences';
import { useAppTheme } from '@/theme';

// Illustrative anchors: the supplied model is one fused mesh, not equipment telemetry.
const anchors = {
  solar: { position: [0, 0.34, -0.06], size: [1.15, 0.14, 1.2] },
  home: { position: [0, 0, 0], size: [1.6, 0.8, 1.45] },
  car: { position: [-0.55, -0.23, 0.7], size: [0.64, 0.35, 0.8] },
  battery: { position: [0.64, -0.13, 0.35], size: [0.28, 0.48, 0.25] },
  grid: { position: [0.84, -0.25, 0.66], size: [0.3, 0.3, 0.3] },
} satisfies Record<HighlightTarget, { position: [number, number, number]; size: [number, number, number] }>;

function House({ pose, holographic, selected }: { pose: HomeCamera; holographic: boolean; selected?: HighlightTarget }) {
  const loaded = useLoader(GLTFLoader, Asset.fromModule(HOME_MODEL_ASSET).uri, loader => { if (Platform.OS === 'web') loader.setMeshoptDecoder(MeshoptDecoder); });
  const { camera, invalidate } = useThree();
  const focus = useMemo(() => ({ focusMin: { value: new Vector3() }, focusMax: { value: new Vector3() }, focusColor: { value: new Color() }, focusStrength: { value: 0 } }), []);
  useEffect(() => {
    const anchor = selected ? anchors[selected] : null;
    focus.focusStrength.value = anchor ? 0.26 : 0;
    if (anchor && selected) {
      const center = new Vector3(...anchor.position), half = new Vector3(...anchor.size).multiplyScalar(0.5);
      focus.focusMin.value.copy(center).sub(half); focus.focusMax.value.copy(center).add(half);
      focus.focusColor.value.set(HIGHLIGHT_COLOR[selected]);
    }
    invalidate();
  }, [selected, focus, invalidate]);
  const scene = useMemo(() => {
    const copy = loaded.scene.clone(true);
    const bounds = new Box3().setFromObject(copy), size = bounds.getSize(new Vector3());
    const scale = 2.2 / Math.max(size.x, size.y, size.z);
    copy.position.sub(bounds.getCenter(new Vector3())).multiplyScalar(scale);
    copy.scale.multiplyScalar(scale);
    copy.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = Array.isArray(object.material) ? object.material[0] : object.material;
      const material = new MeshBasicMaterial({ map: holographic ? null : original.map, color: holographic ? '#68E9F7' : '#FFFFFF', transparent: holographic, opacity: holographic ? 0.72 : 1, side: DoubleSide });
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, focus);
        shader.vertexShader = 'varying vec3 keaWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nkeaWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        shader.fragmentShader = 'varying vec3 keaWorld;uniform vec3 focusMin;uniform vec3 focusMax;uniform vec3 focusColor;uniform float focusStrength;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nvec3 mask=step(focusMin,keaWorld)*step(keaWorld,focusMax);diffuseColor.rgb=mix(diffuseColor.rgb,focusColor,mask.x*mask.y*mask.z*focusStrength);');
        if (holographic) {
          shader.vertexShader = 'varying vec3 vHoloPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloPosition = position;');
          shader.fragmentShader = 'varying vec3 vHoloPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat scan = step(0.88, fract(vHoloPosition.y * 90.0));\ndiffuseColor.rgb *= mix(0.42, 1.25, scan);\ndiffuseColor.a *= mix(0.42, 0.92, scan);');
        }
      };
      material.customProgramCacheKey = () => holographic ? 'kea-focus-holo-v2' : 'kea-focus-unlit-v2';
      object.material = material;
    });
    return copy;
  }, [loaded.scene, holographic, focus]);
  useEffect(() => () => { scene.traverse(object => { if (object instanceof Mesh) (object.material as MeshBasicMaterial).dispose(); }); }, [scene]);
  useEffect(() => {
    const yaw = (35 + pose.x) * Math.PI / 180, pitch = (27 + pose.y) * Math.PI / 180, radius = 3.8 / pose.zoom;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); invalidate();
  }, [camera, invalidate, pose]);
  return <primitive object={scene} />;
}

function WorldSky({ weather, progress }: { weather: AucklandWeather | null; progress: number }) {
  const material = useMemo(() => new ShaderMaterial({ side: BackSide, depthWrite: false, uniforms: {
    top: { value: new Color(weather?.isDay ? '#355F7C' : '#111823') }, horizon: { value: new Color(weather?.isDay ? '#8AA6B2' : '#283D53') }, cloud: { value: (weather?.cloudCoverPercent ?? 0) / 100 },
  }, vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'varying vec3 direction; uniform vec3 top; uniform vec3 horizon; uniform float cloud; void main(){vec3 d=normalize(direction);float h=smoothstep(-0.1,0.7,d.y);vec3 c=mix(horizon,top,h);float w=sin(d.x*18.0+d.z*9.0)*sin(d.z*23.0-d.y*11.0);float mist=smoothstep(0.05,0.65,w)*smoothstep(0.0,0.3,d.y)*(1.0-smoothstep(0.4,0.8,d.y));c=mix(c,vec3(0.75,0.81,0.85),mist*cloud*0.3);gl_FragColor=vec4(c,1.0);}' }), [weather?.isDay, weather?.cloudCoverPercent]);
  useEffect(() => () => material.dispose(), [material]);
  const angle = (progress - 0.5) * 1.4;
  return <group><mesh renderOrder={-2} material={material}><sphereGeometry args={[9, 32, 16]} /></mesh>
    {weather ? <group position={[0.15 + Math.sin(angle) * 0.3, 0.85, -1.65]}>
      <mesh><sphereGeometry args={[weather.isDay ? 0.24 : 0.18, 24, 16]} /><meshBasicMaterial color={weather.isDay ? '#FFE9A2' : '#DCE9F5'} /></mesh>
      <mesh><sphereGeometry args={[weather.isDay ? 0.34 : 0.25, 24, 16]} /><meshBasicMaterial color={weather.isDay ? '#FFE9A2' : '#DCE9F5'} transparent opacity={0.09} depthWrite={false} /></mesh>
    </group> : null}
  </group>;
}

function EnergyPaths({ flows, animated }: { flows: HomeFlow[]; animated: boolean }) {
  const { invalidate } = useThree();
  const paths = useMemo(() => flows.map(flow => {
    const target = anchors[flow.id].position;
    const points = flow.id === 'solar' ? [new Vector3(...target), new Vector3(0.65, 0.32, 0.5), new Vector3(0.65, -0.27, 0.5)] : [new Vector3(0.65, -0.27, 0.5), new Vector3(target[0], -0.28, 0.55), new Vector3(...target)];
    const geometry = new TubeGeometry(new CatmullRomCurve3(points), 40, 0.009, 6, false);
    const material = new ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms: { phase: { value: 0 }, tint: { value: new Color(flow.color) }, flowing: { value: flow.active ? 1 : 0 } }, vertexShader: 'varying vec2 pathUv;void main(){pathUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'uniform float phase;uniform vec3 tint;uniform float flowing;varying vec2 pathUv;void main(){float streak=smoothstep(0.74,0.87,fract(pathUv.x*3.0-phase));gl_FragColor=vec4(tint,0.16+flowing*streak*0.82);}' });
    return { flow, geometry, material };
  }), [flows]);
  useEffect(() => () => { paths.forEach(path => { path.geometry.dispose(); path.material.dispose(); }); }, [paths]);
  useEffect(() => {
    if (!animated || !paths.some(path => path.flow.active)) return;
    const clock = { time: 0 }; let last = 0;
    const tween = gsap.to(clock, { time: 3600, duration: 3600, ease: 'none', repeat: -1, onUpdate: () => {
      if (Date.now() - last < 33) return; last = Date.now();
      paths.forEach(path => { path.material.uniforms.phase!.value = clock.time / path.flow.duration * (path.flow.reverse ? -1 : 1); }); invalidate();
    } });
    return () => { tween.kill(); };
  }, [paths, animated, invalidate]);
  return <group>{paths.map(path => <mesh key={path.flow.id} geometry={path.geometry} material={path.material} renderOrder={3} />)}</group>;
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function GltfHomeScene({ camera, width, height, holographic: override, weather = null, sunProgress = 0.65, selected, flows = [], reduceMotion = true }: { camera: HomeCamera; width: number; height: number; holographic?: boolean; weather?: AucklandWeather | null; sunProgress?: number; selected?: HighlightTarget; flows?: HomeFlow[]; reduceMotion?: boolean }) {
  const preferences = useExperience(), active = useActiveAnimation();
  const { colors } = useAppTheme();
  const fallback = <View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Home model unavailable on this device. Your energy readings are below.</Text></View>;
  return <View accessibilityRole="image" accessibilityLabel={`Interactive smart home model${selected ? `, illustrative ${selected} highlight` : ''}`} style={{ width, height }}>
    <ModelBoundary fallback={fallback}><Suspense fallback={<View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Opening your home…</Text></View>}>
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 42, near: 0.01, far: 20 }} gl={{ alpha: true, antialias: true }} style={{ width, height }}>
        <WorldSky weather={weather} progress={sunProgress} /><House pose={camera} holographic={override ?? preferences.holographic} selected={selected} />
        <EnergyPaths flows={flows} animated={active && !reduceMotion} />
      </Canvas>
    </Suspense></ModelBoundary>
  </View>;
}
