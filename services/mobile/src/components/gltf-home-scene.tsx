import { Asset } from 'expo-asset';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Mesh, MeshBasicMaterial, DoubleSide } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Canvas, useLoader, useThree } from './gltf-canvas';
import type { HomeCamera } from '@/lib/home-camera';
import { useExperience } from '@/lib/experience-preferences';
import { useAppTheme } from '@/theme';

// Metro must resolve the bundled binary at build time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const model = require('../../assets/models/smart_home_energy_system1.glb');

function House({ pose, holographic }: { pose: HomeCamera; holographic: boolean }) {
  const loaded = useLoader(GLTFLoader, Asset.fromModule(model).uri);
  const { camera, invalidate } = useThree();
  const scene = useMemo(() => {
    const copy = loaded.scene.clone(true);
    copy.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = Array.isArray(object.material) ? object.material[0] : object.material;
      const material = new MeshBasicMaterial({ map: holographic ? null : original.map, color: holographic ? '#68E9F7' : '#FFFFFF', transparent: holographic, opacity: holographic ? 0.72 : 1, side: DoubleSide });
      // Surface scan lines avoid generating millions of wireframe edges for this GLB.
      if (holographic) {
        material.onBeforeCompile = shader => {
          shader.vertexShader = 'varying vec3 vHoloPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloPosition = position;');
          shader.fragmentShader = 'varying vec3 vHoloPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat scan = step(0.88, fract(vHoloPosition.y * 90.0));\ndiffuseColor.rgb *= mix(0.42, 1.25, scan);\ndiffuseColor.a *= mix(0.42, 0.92, scan);');
        };
        material.customProgramCacheKey = () => 'kea-holographic-surface-v1';
      }
      object.material = material;
    });
    return copy;
  }, [loaded.scene, holographic]);
  useEffect(() => () => { scene.traverse(object => { if (object instanceof Mesh) (object.material as MeshBasicMaterial).dispose(); }); }, [scene]);
  useEffect(() => {
    const yaw = (35 + pose.x) * Math.PI / 180;
    const pitch = (27 + pose.y) * Math.PI / 180;
    const radius = 3.8 / pose.zoom;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); invalidate();
  }, [camera, invalidate, pose]);
  // React Three Fiber provides this intrinsic.
  // eslint-disable-next-line react/no-unknown-property
  return <primitive object={scene} />;
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The supplied GLB, lazily loaded. Demand rendering avoids an idle 1.5M-triangle loop. */
export function GltfHomeScene({ camera, width, height, holographic: override }: { camera: HomeCamera; width: number; height: number; holographic?: boolean }) {
  const preferences = useExperience();
  const { colors } = useAppTheme();
  const fallback = <View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Home model unavailable on this device. Your energy readings are below.</Text></View>;
  return <View accessibilityRole="image" accessibilityLabel="Interactive smart home model" style={{ width, height }}>
    <ModelBoundary fallback={fallback}><Suspense fallback={<View style={{ height, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textMuted }}>Opening your home…</Text></View>}>
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 42, near: 0.01, far: 20 }} gl={{ alpha: true, antialias: true }} style={{ width, height }}>
        <House pose={camera} holographic={override ?? preferences.holographic} />
      </Canvas>
    </Suspense></ModelBoundary>
  </View>;
}
