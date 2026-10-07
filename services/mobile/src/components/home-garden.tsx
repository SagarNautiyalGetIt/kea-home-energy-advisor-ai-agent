/* eslint-disable react/no-unknown-property */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, ShaderMaterial } from 'three';
import { cloudFrame, grassBlades, WEATHER_BUDGET } from '@/lib/home-weather-world';
import type { homeAtmosphere } from '@/lib/home-presentation';
import { useHomeSceneTick } from './home-scene-motion';
import { useThree } from './gltf-canvas';

type Atmosphere = ReturnType<typeof homeAtmosphere>;

/** One draw call; only the grass tips bend, using the shared GSAP scene time. */
export function HomeGrass({ atmosphere }: { atmosphere: Atmosphere }) {
  const objects = useMemo(() => {
    const positions: number[] = [], tips: number[] = [], shades: number[] = [];
    for (const blade of grassBlades()) {
      const dx = Math.cos(blade.angle) * 0.006, dz = Math.sin(blade.angle) * 0.006;
      positions.push(blade.x - dx, -0.458, blade.z - dz, blade.x + dx, -0.458, blade.z + dz, blade.x, -0.458 + blade.height, blade.z);
      tips.push(0, 0, 1); shades.push(blade.shade, blade.shade, blade.shade);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('tip', new Float32BufferAttribute(tips, 1));
    geometry.setAttribute('shade', new Float32BufferAttribute(shades, 1));
    const material = new ShaderMaterial({ side: DoubleSide, uniforms: { time: { value: 0 }, daylight: { value: 1 } },
      vertexShader: `attribute float tip,shade;uniform float time;varying float bladeTip,bladeShade;
        void main(){vec3 p=position;float gust=0.55+0.25*sin(time*0.55);
          float wave=sin(time*1.7-position.x*3.0-position.z*2.1);
          p.x+=tip*tip*(0.008+wave*0.018)*gust;p.z+=tip*tip*sin(time*1.3+position.x*2.0)*0.009;
          bladeTip=tip;bladeShade=shade;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
      fragmentShader: `uniform float daylight;varying float bladeTip,bladeShade;
        void main(){vec3 grass=mix(vec3(0.16,0.30,0.15),vec3(0.40,0.54,0.26),bladeShade);
          gl_FragColor=vec4(grass*(0.65+bladeTip*0.35)*daylight,1.0);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
  }, []);
  useEffect(() => { objects.material.uniforms.daylight!.value = atmosphere.isDay ? 1 : 0.42; }, [atmosphere.isDay, objects]);
  useHomeSceneTick(useCallback((seconds: number) => { objects.material.uniforms.time!.value = seconds; }, [objects]));
  useEffect(() => () => { objects.geometry.dispose(); objects.material.dispose(); }, [objects]);
  return <mesh visible={!atmosphere.snow} geometry={objects.geometry} material={objects.material} frustumCulled={false} />;
}

/** Soft billboards in world space, occluded by the house and moving with orbit. */
export function HomeClouds({ atmosphere }: { atmosphere: Atmosphere }) {
  const group = useRef<Group>(null);
  const { camera } = useThree();
  const materials = useMemo(() => Array.from({ length: WEATHER_BUDGET.clouds }, () => new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { opacity: { value: 0 }, tint: { value: new Color('#DDE9F0') } },
    vertexShader: 'varying vec2 cloudUv;void main(){cloudUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 cloudUv;uniform float opacity;uniform vec3 tint;
      float puff(vec2 p,vec2 centre,vec2 radius){return 1.0-smoothstep(0.35,1.0,length((p-centre)/radius));}
      void main(){vec2 p=cloudUv-0.5;
        float shape=max(puff(p,vec2(-0.22,-0.08),vec2(0.27,0.29)),max(puff(p,vec2(0.03,0.08),vec2(0.3,0.43)),puff(p,vec2(0.27,-0.09),vec2(0.23,0.26))));
        float alpha=shape*opacity;if(alpha<0.005)discard;gl_FragColor=vec4(tint,alpha);
        #include <colorspace_fragment>
      }`,
  })), []);
  useEffect(() => { materials.forEach(material => { material.uniforms.tint!.value.set(atmosphere.isDay ? '#EDF5F7' : '#899CAF'); }); }, [atmosphere.isDay, materials]);
  useHomeSceneTick(useCallback((seconds: number) => {
    group.current?.children.forEach((object, slot) => {
      const frame = cloudFrame(seconds, slot);
      object.position.set(frame.x, frame.y, frame.z); object.quaternion.copy(camera.quaternion);
      ((object as Mesh).material as ShaderMaterial).uniforms.opacity!.value = frame.opacity * (atmosphere.isDay ? 0.24 : 0.10) * (0.65 + atmosphere.cloud * 0.35);
    });
  }, [camera, atmosphere.cloud, atmosphere.isDay]));
  useEffect(() => () => materials.forEach(material => material.dispose()), [materials]);
  return <group ref={group}>{materials.map((material, slot) => {
    const frame = cloudFrame(0, slot);
    return <mesh key={slot} material={material} position={[frame.x, frame.y, frame.z]} scale={frame.scale} frustumCulled={false}>
      <planeGeometry args={[1.05, 0.38]} />
    </mesh>;
  })}</group>;
}
