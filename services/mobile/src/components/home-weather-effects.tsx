/* eslint-disable react/no-unknown-property */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three';
import { useThree } from './gltf-canvas';
import { useHomeSceneTick } from './home-scene-motion';
import type { homeAtmosphere } from '@/lib/home-presentation';
import { meteorFrame, sceneRandom, starPositions, WEATHER_BUDGET, wildlifeFrame } from '@/lib/home-weather-world';

type Atmosphere = ReturnType<typeof homeAtmosphere>;
type ParticleKind = 'stars' | 'rain' | 'snow' | 'fireflies';
/** Bounded world-space sets; no particle textures or React spawning on ticks. */
function WeatherParticles({ kind, opacity = 1 }: { kind: ParticleKind; opacity?: number }) {
  const objects = useMemo(() => {
    const points = kind === 'stars' ? starPositions().flat() : Array.from({ length: WEATHER_BUDGET[kind] }, (_, i) => {
      const a = sceneRandom(i + 1), b = sceneRandom(i + 2), c = sceneRandom(i + 3);
      return kind === 'fireflies' ? [(a - 0.5) * 3.2, b * 0.75 - 0.1, -1.3 - c * 0.7] : [(a - 0.5) * 3.8, b * 2.8 - 0.5, (c - 0.5) * 3.6];
    }).flat();
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new ShaderMaterial({ transparent: true, depthTest: true, depthWrite: false, uniforms: { time: { value: 0 }, opacity: { value: opacity }, mode: { value: kind === 'stars' ? 0 : kind === 'rain' ? 1 : kind === 'snow' ? 2 : 3 } },
      vertexShader: `uniform float time,mode;varying float flicker,skyFade;
        void main(){vec3 p=position;float seed=p.x*7.0+p.z*11.0;
          if(mode>0.5&&mode<2.5){p.y=mod(position.y+0.5-time*(mode<1.5?0.95:0.15),2.8)-0.5;p.x+=sin(time*0.4+seed)*(mode<1.5?0.03:0.12);}
          if(mode>2.5){p.x+=sin(time*0.35+seed)*0.12;p.y+=sin(time*0.6+seed)*0.08;}
          flicker=mode>2.5?pow(max(0.0,sin(time*0.65+seed)),2.0):(0.55+sin(time*0.6+seed)*0.35);
          vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
          skyFade=mode<0.5?smoothstep(-0.15,0.25,gl_Position.y/gl_Position.w):1.0;
          gl_PointSize=mode<0.5?2.8:(mode<1.5?12.0:(mode<2.5?4.5:3.5));}`,
      fragmentShader: `uniform float mode,opacity;varying float flicker,skyFade;
        void main(){vec2 p=gl_PointCoord-0.5;
          float shape=mode>0.5&&mode<1.5?1.0-smoothstep(0.025,0.095,abs(p.x+p.y*0.14)):1.0-smoothstep(0.1,0.5,length(p));
          float alpha=shape*(mode<0.5||mode>2.5?flicker:0.62)*opacity*skyFade;
          if(alpha<0.015)discard;vec3 tint=mode>2.5?vec3(0.72,1.0,0.43):(mode<1.5?vec3(0.72,0.86,1.0):vec3(0.95,0.98,1.0));
          gl_FragColor=vec4(tint,alpha);
          #include <colorspace_fragment>
        }` });
    return { geometry, material };
  }, [kind, opacity]);
  useHomeSceneTick(useCallback((seconds: number) => { objects.material.uniforms.time!.value = seconds; }, [objects]));
  useEffect(() => () => { objects.geometry.dispose(); objects.material.dispose(); }, [objects]);
  return <points geometry={objects.geometry} material={objects.material} frustumCulled={false} />;
}

/** One short quad trail, anchored in world space at each four-second event. */
function ShootingStar() {
  const { camera } = useThree();
  const objects = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const material = new ShaderMaterial({ transparent: true, side: DoubleSide, depthWrite: false, uniforms: { opacity: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv;uniform float opacity;void main(){float core=1.0-smoothstep(0.05,0.5,abs(vUv.y-0.5));gl_FragColor=vec4(mix(vec3(0.36,0.74,1.0),vec3(1.0),vUv.x),core*vUv.x*opacity);\n#include <colorspace_fragment>\n}' });
    return { geometry, material, from: new Vector3(), to: new Vector3(), ray: new Vector3(), right: new Vector3(), head: new Vector3(), tail: new Vector3(), cycle: -1 };
  }, []);
  useHomeSceneTick(useCallback((seconds: number) => {
    const frame = meteorFrame(seconds);
    if (frame.cycle !== objects.cycle) {
      camera.updateMatrixWorld();
      const at = (point: readonly number[], target: Vector3) => { objects.ray.set(point[0]!, point[1]!, 0.5).unproject(camera).sub(camera.position).normalize(); target.copy(camera.position).addScaledVector(objects.ray, 6); };
      at(frame.from, objects.from); at(frame.to, objects.to); objects.cycle = frame.cycle;
    }
    objects.material.uniforms.opacity!.value = frame.opacity;
    if (!frame.opacity) return;
    objects.head.lerpVectors(objects.from, objects.to, frame.t); objects.tail.lerpVectors(objects.from, objects.to, Math.max(0, frame.t - 0.24));
    objects.right.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(0.006);
    const vertices = objects.geometry.getAttribute('position');
    for (let i = 0; i < 4; i++) { const point = i < 2 ? objects.tail : objects.head, side = i % 2 ? 1 : -1; vertices.setXYZ(i, point.x + objects.right.x * side, point.y + objects.right.y * side, point.z + objects.right.z * side); }
    vertices.needsUpdate = true;
  }, [camera, objects]));
  useEffect(() => () => { objects.geometry.dispose(); objects.material.dispose(); }, [objects]);
  return <mesh geometry={objects.geometry} material={objects.material} frustumCulled={false} />;
}

function Wildlife({ butterflies }: { butterflies: boolean }) {
  const group = useRef<Group>(null);
  useHomeSceneTick(useCallback((seconds: number) => {
    group.current?.children.forEach((object, i) => {
      const frame = wildlifeFrame(seconds, i, butterflies);
      object.position.set(frame.x, frame.y, frame.z); object.rotation.z = Math.sin(seconds * 0.7 + i) * 0.15;
      object.visible = frame.opacity > 0.01;
      object.children.forEach((wing, side) => { wing.rotation.y = Math.sin(seconds * (butterflies ? 9 : 5) + i) * 0.7 * (side === 0 ? 1 : -1); ((wing as Mesh).material as MeshBasicMaterial).opacity = frame.opacity; });
    });
  }, [butterflies]));
  return <group ref={group}>{[0, 1, 2].map(i => <group key={i} position={[(i - 1) * 0.45, butterflies ? 0.1 : 0.7, butterflies ? 0.8 : -2]}>
    {[-1, 1].map(side => <mesh key={side} scale={butterflies ? [0.012, 0.022, 0.003] : [0.035, 0.006, 0.008]} position={[side * (butterflies ? 0.01 : 0.028), 0, 0]} rotation={[0, 0, side * (butterflies ? 0.25 : 0.55)]}>
      <sphereGeometry args={[1, 6, 4]} /><meshBasicMaterial transparent depthWrite={false} color={butterflies ? ['#FFD48A', '#C7B9FF', '#FFAEC2'][i] : '#68869C'} />
    </mesh>)}
  </group>)}</group>;
}

export function HomeWeatherEffects({ atmosphere }: { atmosphere: Atmosphere }) {
  return <group>
    {atmosphere.stars ? <><WeatherParticles kind="stars" opacity={atmosphere.starOpacity} /><ShootingStar /></> : null}
    {atmosphere.rain ? <WeatherParticles kind="rain" /> : null}
    {atmosphere.snow ? <WeatherParticles kind="snow" /> : null}
    {atmosphere.fireflies ? <WeatherParticles kind="fireflies" /> : null}
    {atmosphere.birds ? <Wildlife butterflies={false} /> : null}
    {atmosphere.butterflies ? <Wildlife butterflies /> : null}
  </group>;
}
