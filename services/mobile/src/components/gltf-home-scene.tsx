/* React Three Fiber supplies the scene intrinsics. */
/* eslint-disable react/no-unknown-property */
import { Asset } from 'expo-asset';
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PixelRatio, Platform, Text, View } from 'react-native';
import { BackSide, Box3, CatmullRomCurve3, Color, DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, ShaderMaterial, TubeGeometry, Vector3 } from 'three';
import { HomeModelLoader } from '@/lib/home-model-loader';
import { homeRenderDpr } from '@/lib/home-render-budget';
import { createHomeModelResource, type HomeModelResult } from '@/lib/home-model-resource';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Canvas, useThree } from './gltf-canvas';
import type { HomeCamera } from '@/lib/home-camera';
import { conduitPoints, equipmentRegions } from '@/lib/home-equipment';
import { HOME_MODEL_ASSET } from '@/lib/home-model-asset';
import type { HomeFlow } from '@/lib/home-flows';
import type { AucklandWeather } from '@/lib/auckland-weather';
import { HIGHLIGHT_COLOR, type HighlightTarget } from './visual-highlight';
import { useActiveAnimation } from '@/lib/use-active-animation';
import { useExperience } from '@/lib/experience-preferences';
import { useAppTheme } from '@/theme';
import { homeAtmosphere } from '@/lib/home-presentation';
import { HomeSceneMotion, useHomeSceneTick } from './home-scene-motion';
import { HomeWeatherEffects } from './home-weather-effects';
import { HomeClouds, HomeGrass } from './home-garden';
import { HomeNatureSound } from './home-nature-sound';
import { HOME_GROUND_RADIUS, NIGHT_APERTURES, NIGHT_WINDOW_SHADER, weatherPalette } from '@/lib/home-weather-world';

const homeModel = createHomeModelResource(async url => {
  const loader = new HomeModelLoader();
  if (Platform.OS === 'web') loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.loadAsync(url);
});

function House({ loaded, pose, holographicMix, nightLight, selected, onReady }: { loaded: GLTF; pose: HomeCamera; holographicMix: number; nightLight: number; selected?: HighlightTarget; onReady?: () => void }) {
  const { camera, invalidate } = useThree();
  const focus = useMemo(() => ({ focusCenter: { value: new Vector3() }, focusHalf: { value: new Vector3() }, focusX: { value: new Vector3() }, focusY: { value: new Vector3() }, focusZ: { value: new Vector3() }, focusColor: { value: new Color() }, focusStrength: { value: 0 }, homeSelected: { value: 0 }, holoMix: { value: 1 }, nightLight: { value: 0 } }), []);
  useEffect(() => { focus.holoMix.value = Math.max(0, Math.min(1, holographicMix)); focus.nightLight.value = nightLight; invalidate(); }, [holographicMix, nightLight, focus, invalidate]);
  useEffect(() => {
    const anchor = selected ? equipmentRegions[selected] : null;
    focus.focusStrength.value = anchor ? 0.42 : 0;
    focus.homeSelected.value = selected === 'home' ? 1 : 0;
    if (anchor && selected) {
      focus.focusCenter.value.set(...anchor.center); focus.focusHalf.value.set(...anchor.half);
      focus.focusX.value.set(...anchor.axisX); focus.focusY.value.set(...anchor.axisY); focus.focusZ.value.set(...anchor.axisZ);
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
      // One original-texture material; the reveal only changes uniforms, never
      // clones/reloads the heavy mesh or swaps programs halfway through a frame.
      const material = new MeshBasicMaterial({ map: original.map, color: '#FFFFFF', transparent: true, opacity: 1, side: DoubleSide });
      material.forceSinglePass = true;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, focus);
        shader.vertexShader = 'varying vec3 keaWorld;varying vec3 vHoloPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloPosition=position;').replace('#include <project_vertex>', '#include <project_vertex>\nkeaWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        const exclude = (['solar', 'car', 'battery', 'grid'] as const).map(key => {
          const r = equipmentRegions[key];
          const vec = (v: readonly number[]) => `vec3(${v.map(n => n.toFixed(5)).join(',')})`;
          return `equipmentMask=max(equipmentMask,region(keaWorld,${vec(r.center)},${vec(r.half)},${vec(r.axisX)},${vec(r.axisY)},${vec(r.axisZ)}));`;
        }).join('\n');
        shader.fragmentShader = 'varying vec3 keaWorld;varying vec3 vHoloPosition;uniform vec3 focusCenter,focusHalf,focusX,focusY,focusZ,focusColor;uniform float focusStrength,homeSelected,holoMix,nightLight;float region(vec3 p,vec3 c,vec3 h,vec3 x,vec3 y,vec3 z){vec3 d=p-c;vec3 m=step(abs(vec3(dot(d,x),dot(d,y),dot(d,z))),h);return m.x*m.y*m.z;}\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float scan=step(0.88,fract(vHoloPosition.y*90.0));
          vec3 hologram=vec3(0.408,0.914,0.969)*mix(0.42,1.25,scan);
          diffuseColor.rgb=mix(diffuseColor.rgb,hologram,holoMix);
          diffuseColor.a*=mix(1.0,0.72*mix(0.42,0.92,scan),holoMix);
          // Insets target glass itself, including the almost-black upper panes.
          // A luminance gate would reject those panes after linear texture conversion.
          float windows=0.0;${NIGHT_WINDOW_SHADER}
          // Frosted warm glass with subtle vertical light falloff; not a claim
          // that a customer's actual lights are on. Black mullions stay dark.
          vec3 warm=mix(vec3(0.60,0.28,0.075),vec3(1.0,0.68,0.32),smoothstep(-0.35,-0.06,keaWorld.y));
          diffuseColor.rgb=mix(diffuseColor.rgb,warm,windows*nightLight*(1.0-holoMix)*0.82);
          float mask=region(keaWorld,focusCenter,focusHalf,focusX,focusY,focusZ);float equipmentMask=0.0;${exclude}
          mask*=1.0-homeSelected*equipmentMask;diffuseColor.rgb=mix(diffuseColor.rgb,focusColor,mask*focusStrength);`);
      };
      material.customProgramCacheKey = () => 'kea-focus-reveal-windows-v6';
      object.material = material;
    });
    return copy;
  }, [loaded.scene, focus]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => () => { scene.traverse(object => { if (object instanceof Mesh) (object.material as MeshBasicMaterial).dispose(); }); }, [scene]);
  useEffect(() => {
    const yaw = (35 + pose.x) * Math.PI / 180, pitch = (27 + pose.y) * Math.PI / 180, radius = 3.1 / pose.zoom;
    const target = new Vector3(pose.focusX ?? 0, -0.1 + (pose.focusY ?? 0), pose.focusZ ?? 0);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius).add(target);
    camera.lookAt(target); camera.updateProjectionMatrix(); invalidate();
  }, [camera, invalidate, pose]);
  return <primitive object={scene} />;
}

function SceneViewport({ width, height, skyExtension }: { width: number; height: number; skyExtension: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    // Extend the visible sky upward while keeping the house's scale and position.
    camera.setViewOffset(width, height - skyExtension, 0, -skyExtension, width, height);
    invalidate();
    return () => { camera.clearViewOffset(); invalidate(); };
  }, [camera, height, invalidate, skyExtension, width]);
  return null;
}

function WorldSky({ atmosphere, progress }: { atmosphere: ReturnType<typeof homeAtmosphere>; progress: number }) {
  const palette = weatherPalette(atmosphere.isDay, atmosphere.condition);
  const material = useMemo(() => new ShaderMaterial({ side: BackSide, depthTest: false, depthWrite: false, uniforms: {
    top: { value: new Color(palette.top) }, horizon: { value: new Color(palette.horizon) }, mist: { value: new Color(palette.mist) }, cloud: { value: atmosphere.cloud }, time: { value: 0 },
  }, vertexShader: 'varying vec3 direction;varying vec4 skyClip; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);skyClip=gl_Position;}',
  // Isometric cameras look down: an astronomical y=0 horizon is outside the
  // viewport. Keep the stylized sky band above the scene while the cloud pattern
  // remains world-anchored and moves with orbit, just like the sun/star shell.
  fragmentShader: 'varying vec3 direction;varying vec4 skyClip; uniform vec3 top,horizon,mist; uniform float cloud,time; void main(){vec3 d=normalize(direction);float screenY=skyClip.y/skyClip.w;float h=smoothstep(-0.25,0.9,screenY);vec3 c=mix(horizon,top,h);float w=sin(d.x*8.0+d.z*4.0+time*0.025)*sin(d.z*11.0-d.y*6.0+time*0.02);float wisps=smoothstep(0.12,0.7,w)*smoothstep(0.05,0.4,screenY);c=mix(c,mist,wisps*cloud*0.32);gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}' }), [palette.top, palette.horizon, palette.mist, atmosphere.cloud]);
  useHomeSceneTick(useCallback((seconds: number) => { material.uniforms.time!.value = seconds; }, [material]));
  useEffect(() => () => material.dispose(), [material]);
  const angle = (progress - 0.5) * 1.4;
  return <group><mesh renderOrder={-2} material={material}><sphereGeometry args={[9, 32, 16]} /></mesh>
    {/* A matte world floor below the supplied pavement, never a reflective sky lower hemisphere. */}
    <mesh position={[0, -0.46, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <circleGeometry args={[HOME_GROUND_RADIUS, 64]} /><meshBasicMaterial color={palette.ground} />
    </mesh>
    <group position={[0.15 + Math.sin(angle) * 0.3, 0.5, -1.65]}>
      <mesh><sphereGeometry args={[atmosphere.isDay ? 0.24 : 0.18, 24, 16]} /><meshBasicMaterial color={palette.body} transparent opacity={Math.max(0.22, 1 - atmosphere.cloud * 0.65)} /></mesh>
      <mesh><sphereGeometry args={[atmosphere.isDay ? 0.34 : 0.25, 24, 16]} /><meshBasicMaterial color={atmosphere.isDay ? '#FFE9A2' : '#DCE9F5'} transparent opacity={0.09} depthWrite={false} /></mesh>
    </group>
  </group>;
}

function EnergyPaths({ flows }: { flows: HomeFlow[] }) {
  const paths = useMemo(() => flows.map(flow => {
    const points = conduitPoints[flow.id].map(point => new Vector3(...point));
    const geometry = new TubeGeometry(new CatmullRomCurve3(points, false, 'centripetal'), 120, 0.009, 6, false);
    const material = new ShaderMaterial({ transparent: true, depthTest: true, depthWrite: false, uniforms: { phase: { value: 0 }, tint: { value: new Color(flow.color) }, flowing: { value: flow.active ? 1 : 0 } }, vertexShader: 'varying vec2 pathUv;void main(){pathUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: `uniform float phase;uniform vec3 tint;uniform float flowing;varying vec2 pathUv;
      void main(){
        // Twice as many soft pulses; double phase preserves the original speed.
        float pulse=pow(max(0.0,cos((pathUv.x*6.0-phase*2.0)*6.2831853)),3.0);
        // Saturated opaque centre and soft coloured rim retain each path's hue.
        float rim=0.5+0.5*sin(pathUv.y*6.2831853);
        vec3 core=tint*(0.9+pulse*0.32);
        gl_FragColor=vec4(core,(0.72+pulse*0.28)*(0.76+rim*0.24)*flowing);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    return { flow, geometry, material };
  }), [flows]);
  useEffect(() => () => { paths.forEach(path => { path.geometry.dispose(); path.material.dispose(); }); }, [paths]);
  useHomeSceneTick(useCallback((seconds: number) => { paths.forEach(path => { path.material.uniforms.phase!.value = seconds / path.flow.duration * (path.flow.reverse ? -1 : 1); }); }, [paths]));
  return <group>{paths.map(path => <mesh key={path.flow.id} geometry={path.geometry} material={path.material} renderOrder={3} />)}</group>;
}

function WindowInteriors({ nightLight, holographicMix }: { nightLight: number; holographicMix: number }) {
  // Backings fill real empty apertures; existing opaque glazing is lit in House.
  // Inset behind frame planes so occlusion preserves timber and black mullions.
  const opacity = nightLight * (1 - holographicMix) * 0.78;
  return <group>{NIGHT_APERTURES.map((pane, i) => <mesh key={i} position={[...pane.center]} rotation={[0, pane.side ? Math.PI / 2 : 0, 0]} visible={opacity > 0}>
    <planeGeometry args={[pane.width, pane.height]} /><meshBasicMaterial color="#EFB96E" side={DoubleSide} transparent opacity={opacity} />
  </mesh>)}</group>;
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function GltfHomeScene({ camera, width, height, skyExtension = 0, holographic: override, holographicMix, weather = null, sunProgress = 0.65, selected, flows = [], reduceMotion = true, onReady }: { camera: HomeCamera; width: number; height: number; skyExtension?: number; holographic?: boolean; holographicMix?: number; weather?: AucklandWeather | null; sunProgress?: number; selected?: HighlightTarget; flows?: HomeFlow[]; reduceMotion?: boolean; onReady?: () => void }) {
  const preferences = useExperience(), active = useActiveAnimation();
  const [model, setModel] = useState<HomeModelResult<GLTF> | null>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => homeModel(Asset.fromModule(HOME_MODEL_ASSET).uri)).then(
      result => { if (mounted) setModel(result); },
      () => { if (mounted) setModel({ status: 'unavailable' }); },
    );
    return () => { mounted = false; };
  }, []);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!active) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, [active]);
  const atmosphere = useMemo(() => homeAtmosphere(weather, now), [weather, now]);
  const { colors } = useAppTheme();
  const mix = holographicMix ?? ((override ?? preferences.holographic) ? 1 : 0);
  const fallback = <View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Home model unavailable on this device. Your energy readings are below.</Text></View>;
  return <View accessibilityRole="image" accessibilityLabel={`Interactive smart home model${selected ? `, illustrative ${selected} highlight` : ''}`} style={{ width, height }}>
    {model?.status === 'ready' && preferences.natureSounds ? <HomeNatureSound birds={atmosphere.birds} /> : null}
    {model?.status === 'unavailable' ? fallback : !model ? <View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Opening your home…</Text></View> : <ModelBoundary fallback={fallback}>
      <Canvas frameloop="demand" dpr={homeRenderDpr(width, height, PixelRatio.get())} camera={{ fov: 42, near: 0.01, far: 20 }} gl={{ alpha: true, antialias: false }} style={{ width, height }}>
        <HomeSceneMotion animated={active && !reduceMotion}>
          <SceneViewport width={width} height={height} skyExtension={skyExtension} />
          <WorldSky atmosphere={atmosphere} progress={sunProgress} /><HomeGrass atmosphere={atmosphere} /><HomeClouds atmosphere={atmosphere} /><HomeWeatherEffects atmosphere={atmosphere} />
          <House loaded={model.model} pose={camera} holographicMix={mix} nightLight={atmosphere.nightLight} selected={selected} onReady={onReady} />
          <WindowInteriors nightLight={atmosphere.nightLight} holographicMix={mix} />
          <EnergyPaths flows={flows} />
        </HomeSceneMotion>
      </Canvas>
    </ModelBoundary>}
  </View>;
}
