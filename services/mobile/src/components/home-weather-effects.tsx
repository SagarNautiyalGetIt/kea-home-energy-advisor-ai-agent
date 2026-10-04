/* eslint-disable react/no-unknown-property */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, Group, ShaderMaterial } from 'three';
import { useHomeSceneTick } from './home-scene-motion';
import type { homeAtmosphere } from '@/lib/home-presentation';

type Atmosphere = ReturnType<typeof homeAtmosphere>;
/** Small deterministic sets: every effect occupies the same world as the house. */
function WeatherParticles({ kind }: { kind: 'stars' | 'rain' | 'snow' }) {
  const objects = useMemo(() => {
    const count = kind === 'stars' ? 72 : 44;
    const points: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = ((i * 73 + 19) % 101) / 101, b = ((i * 47 + 11) % 103) / 103, c = ((i * 31 + 7) % 107) / 107;
      points.push((a - 0.5) * (kind === 'stars' ? 12 : 4), kind === 'stars' ? 1.8 + b * 4 : b * 2.8 - 0.5, kind === 'stars' ? -3 - c * 3 : (c - 0.5) * 3.6);
    }
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new ShaderMaterial({ transparent: true, depthTest: true, depthWrite: false, uniforms: { time: { value: 0 }, mode: { value: kind === 'stars' ? 0 : kind === 'rain' ? 1 : 2 } },
      vertexShader: 'uniform float time,mode;varying float flicker;void main(){vec3 p=position;float seed=p.x*7.0+p.z*11.0;if(mode>0.5){p.y=mod(position.y+0.5-time*(mode<1.5?0.85:0.18),2.8)-0.5;p.x+=sin(time*0.4+seed)*0.04;}flicker=0.65+sin(time*0.5+seed)*0.2;vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=mode<0.5?2.5:(mode<1.5?10.0:4.0);}',
      fragmentShader: 'uniform float mode;varying float flicker;void main(){vec2 p=gl_PointCoord-0.5;float shape=mode>0.5&&mode<1.5?1.0-smoothstep(0.02,0.09,abs(p.x)):1.0-smoothstep(0.18,0.5,length(p));float alpha=shape*(mode<0.5?flicker:0.4);if(alpha<0.02)discard;gl_FragColor=vec4(mode<1.5?vec3(0.77,0.87,1.0):vec3(0.95,0.98,1.0),alpha);}' });
    return { geometry, material };
  }, [kind]);
  useHomeSceneTick(useCallback((seconds: number) => { objects.material.uniforms.time!.value = seconds; }, [objects]));
  useEffect(() => () => { objects.geometry.dispose(); objects.material.dispose(); }, [objects]);
  return <points geometry={objects.geometry} material={objects.material} frustumCulled={false} />;
}
function Wildlife({ butterflies }: { butterflies: boolean }) {
  const group = useRef<Group>(null);
  useHomeSceneTick(useCallback((seconds: number) => {
    group.current?.children.forEach((object, i) => {
      const phase = seconds * (butterflies ? 0.65 : 0.18) + i * 1.9;
      object.position.x = Math.sin(phase) * (butterflies ? 0.3 : 1.9) + (butterflies ? -0.82 : 0);
      object.position.y = (butterflies ? -0.06 : 0.88) + Math.sin(phase * 1.7) * 0.09;
      object.rotation.z = Math.sin(phase) * 0.2;
      object.children.forEach((wing, side) => { wing.rotation.y = Math.sin(seconds * (butterflies ? 7 : 4) + i) * 0.6 * (side === 0 ? 1 : -1); });
    });
  }, [butterflies]));
  return <group ref={group}>{[0, 1, 2].map(i => <group key={i} position={[butterflies ? -0.8 : i - 1, butterflies ? -0.06 : 0.88, butterflies ? 0.7 + i * 0.12 : -2.2 - i * 0.15]}>
    {[-1, 1].map(side => <mesh key={side} scale={butterflies ? [0.021, 0.033, 0.004] : [0.055, 0.008, 0.012]} position={[side * (butterflies ? 0.018 : 0.045), 0, 0]} rotation={[0, 0, side * (butterflies ? 0.25 : 0.55)]}>
      <sphereGeometry args={[1, 6, 4]} /><meshBasicMaterial color={butterflies ? ['#FBCB76', '#B6ABEF', '#F7A8BC'][i] : '#A6BBC9'} />
    </mesh>)}
  </group>)}</group>;
}
export function HomeWeatherEffects({ atmosphere }: { atmosphere: Atmosphere }) {
  return <group>
    {atmosphere.stars ? <WeatherParticles kind="stars" /> : null}
    {atmosphere.rain ? <WeatherParticles kind="rain" /> : null}
    {atmosphere.snow ? <WeatherParticles kind="snow" /> : null}
    {atmosphere.birds ? <Wildlife butterflies={false} /> : null}
    {atmosphere.butterflies ? <Wildlife butterflies /> : null}
  </group>;
}
