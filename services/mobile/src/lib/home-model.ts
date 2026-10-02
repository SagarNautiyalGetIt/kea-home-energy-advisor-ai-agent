import type { HomeCamera } from './home-camera';

export type HomePart = 'home' | 'solar' | 'battery' | 'grid' | 'car';
export type Point3 = readonly [number, number, number];
export type ModelFace = { id: string; part: HomePart | null; vertices: Point3[]; color: string; flowProgress?: number };
export type ProjectedFace = ModelFace & { points: string; depth: number; fill: string };

// World coordinates, in metres: Y is up, +Z faces the driveway. Every wall,
// window, panel and vehicle is geometry, including the normally hidden sides.
const faces: ModelFace[] = [];
function face(id: string, part: HomePart | null, vertices: Point3[], color: string) {
  faces.push({ id, part, vertices, color });
}
function box(id: string, part: HomePart | null, min: Point3, max: Point3, color: string) {
  const [x, y, z] = min;
  const [X, Y, Z] = max;
  face(id + '-front', part, [[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]], color);
  face(id + '-back', part, [[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]], color);
  face(id + '-right', part, [[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]], color);
  face(id + '-left', part, [[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]], color);
  face(id + '-top', part, [[x,Y,Z],[X,Y,Z],[X,Y,z],[x,Y,z]], color);
  face(id + '-bottom', part, [[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]], color);
}
const timber = '#95694b';
const frame = '#343b42';
const glass = '#7694a5';
function gable(id: string, left: number, right: number, back: number, front: number, eave: number, ridge: number) {
  const mid = (left + right) / 2;
  box(id, 'home', [left,0,back], [right,eave,front], timber);
  face(id + '-gable-front', 'home', [[left,eave,front],[right,eave,front],[mid,ridge,front]], timber);
  face(id + '-gable-back', 'home', [[right,eave,back],[left,eave,back],[mid,ridge,back]], timber);
  const l = left - 0.14, r = right + 0.14, b = back - 0.15, f = front + 0.15;
  face(id + '-roof-right', 'home', [[mid,ridge,b],[mid,ridge,f],[r,eave,f],[r,eave,b]], '#64717e');
  face(id + '-roof-left', 'home', [[l,eave,b],[l,eave,f],[mid,ridge,f],[mid,ridge,b]], '#64717e');
  // Tile courses follow the roof planes instead of a texture tied to the camera.
  for (let row = 1; row < 8; row++) {
    const t = row / 8;
    for (const side of [-1, 1]) {
      const x = mid + side * (r - mid) * t;
      const y = ridge + (eave - ridge) * t + 0.008;
      const slope = side * (eave-ridge)/(r-mid);
      face(id + '-tile-' + side + '-' + row, 'home', [[x-0.008,y-0.008*slope,b],[x-0.008,y-0.008*slope,f],[x+0.008,y+0.008*slope,f],[x+0.008,y+0.008*slope,b]], '#4e5b69');
    }
  }
  box(id + '-front-fascia', 'home', [left-0.04,eave-0.15,front+0.015], [right+0.04,eave,front+0.08], frame);
}
function frontWindow(id: string, left: number, right: number, bottom: number, top: number, z: number) {
  box(id + '-frame', 'home', [left,bottom,z], [right,top,z+0.04], frame);
  const pane = z < 0 ? z-0.012 : z+0.045;
  const bar = z < 0 ? z-0.022 : z+0.054;
  const reflection = z < 0 ? z-0.023 : z+0.063;
  box(id + '-glass', 'home', [left+0.06,bottom+0.06,pane], [right-0.06,top-0.06,pane+0.007], glass);
  box(id + '-mullion', 'home', [(left+right)/2-0.025,bottom,bar], [(left+right)/2+0.025,top,bar+0.008], frame);
  const triangle: Point3[] = [[left+0.07,top-0.07,reflection],[right-0.07,top-0.07,reflection],[right-0.07,bottom+0.45,reflection]];
  face(id + '-reflection', 'home', z < 0 ? triangle : triangle.reverse(), '#90acbc');
}

box('foundation', null, [-3.45,-0.17,-2.4], [3.5,-0.07,2.48], '#939aa1');
box('driveway', null, [-1.45,-0.19,2.48], [3.55,-0.09,5.1], '#a3a8ad');
for (let z = 2.8; z < 5.1; z += 0.4) box('paving-' + z, null, [-1.44,-0.085,z], [3.54,-0.08,z+0.012], '#858d96');
gable('main', -0.45, 3, -2.1, 2.1, 3.2, 4.5);
gable('wing', -3, -0.45, -2.1, 0.7, 3.2, 4.16);
// Cedar boards on all exposed elevations, with deterministic material variation.
for (let i = 0; i < 40; i++) {
  const x = -3 + i * 0.15;
  const z = x < -0.45 ? 0.711 : 2.111;
  const X = Math.min(x+0.13,3), color = i % 3 === 0 ? '#ad7d58' : '#9d704f';
  face('cedar-front-' + i, 'home', [[x+0.035,0,z],[X,0,z],[X,3.19,z],[x+0.035,3.19,z]], color);
  face('cedar-back-' + i, 'home', [[X,0,-2.125],[x+0.035,0,-2.125],[x+0.035,3.19,-2.125],[X,3.19,-2.125]], color);
}
for (let i = 0; i < 28; i++) {
  const z = -2.1 + i * 0.15;
  face('cedar-side-' + i, 'home', [[3.023,0,z+0.13],[3.023,0,z+0.03],[3.023,3.19,z+0.03],[3.023,3.19,z+0.13]], i % 3 === 0 ? '#ad7d58' : '#9d704f');
}
frontWindow('wing-lower', -2.62,-0.8,0.12,1.54,0.74);
frontWindow('wing-upper', -2.62,-0.8,1.91,2.97,0.74);
frontWindow('main-lower', 0.22,2.65,0.12,1.65,2.15);
frontWindow('main-upper', 0.22,2.65,1.95,3.03,2.15);
// Rear glazing means an orbit can reveal a complete building, not an empty shell.
frontWindow('rear', -2.6,2.55,0.18,1.55,-2.23);
box('entry', 'home', [-0.43,0,0.83], [-0.35,1.65,1.46], frame);
for (const x of [-3.025, -0.49, 2.96]) box('upright-' + x, 'home', [x,0,x < -0.5 ? 0.72 : 2.13], [x+0.07,3.2,x < -0.5 ? 0.81 : 2.22], frame);
box('storey-band-wing', 'home', [-3.04,1.63,0.76], [-0.43,1.8,0.86], frame);
box('storey-band-main', 'home', [-0.47,1.73,2.15], [3.06,1.9,2.25], frame);
box('storey-band-side', 'home', [3.04,1.73,-2.1], [3.11,1.9,2.25], frame);
// Solar cells are quadrilaterals on the sloping roof, lifted off it by 3 cm.
for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
  const a = 1.56 + row * 0.36, b = a + 0.32, z = -1.7 + col * 0.56;
  const roofY = (x: number) => 4.5 - (x - 1.275) * 1.3 / 1.865 + 0.035;
  face('solar-' + row + '-' + col, 'solar', [[a,roofY(a),z],[a,roofY(a),z+0.51],[b,roofY(b),z+0.51],[b,roofY(b),z]], '#243f5b');
}
box('battery', 'battery', [3.05,0.32,0.24], [3.32,1.65,1.02], '#e0e5e4');
box('battery-indicator', 'battery', [3.325,1.23,0.32], [3.334,1.27,0.5], '#5abc86');
box('inverter', 'solar', [3.06,1.26,-0.65], [3.25,1.93,-0.22], '#d6dddd');
box('charger', 'car', [3.07,0.82,1.5], [3.23,1.34,1.76], frame);
box('grid-base', 'grid', [4.02,-0.16,-0.56], [5.05,-0.06,0.58], '#8a949e');
box('grid', 'grid', [4.11,0,-0.48], [4.96,1.24,0.49], '#a7b1b3');
box('grid-door', 'grid', [4.17,0.07,0.501], [4.9,1.14,0.517], '#8e999b');
box('grid-handle', 'grid', [4.56,0.55,0.519], [4.59,0.73,0.56], frame);

// A chamfered body and inset greenhouse give the EV volume from every angle.
const carX = 1.06;
function carRing(y: number, w: number, front: number, back: number): Point3[] {
  return [[carX-w,y,front-0.15],[carX-w+0.14,y,front],[carX+w-0.14,y,front],[carX+w,y,front-0.15],[carX+w,y,back+0.15],[carX+w-0.14,y,back],[carX-w+0.14,y,back],[carX-w,y,back+0.15]];
}
const rings = [carRing(0.16,0.67,4.87,2.48),carRing(0.52,0.73,4.72,2.59),carRing(0.64,0.63,4.56,2.7)];
for (let layer = 0; layer < rings.length - 1; layer++) for (let i = 0; i < 8; i++) {
  const j = (i+1)%8;
  face('car-body-' + layer + '-' + i, 'car', [rings[layer]![j]!,rings[layer+1]![j]!,rings[layer+1]![i]!,rings[layer]![i]!], '#aebcc8');
}
face('car-bonnet', 'car', [...rings[2]!], '#bbc8d1');
const lower = [[carX-0.59,0.66,4.08],[carX+0.59,0.66,4.08],[carX+0.59,0.66,2.87],[carX-0.59,0.66,2.87]] as Point3[];
const upper = [[carX-0.46,1.02,3.79],[carX+0.46,1.02,3.79],[carX+0.46,1.02,3.03],[carX-0.46,1.02,3.03]] as Point3[];
for (let i = 0; i < 4; i++) { const j=(i+1)%4; face('car-glass-' + i, 'car', [lower[j]!,upper[j]!,upper[i]!,lower[i]!], '#3f5d73'); }
face('car-roof', 'car', [...upper], '#acbdcb');
for (const x of [carX-0.74,carX+0.68]) for (const z of [2.99,4.24]) {
  // Cylinder axes run across the axle, with twelve facets rather than flat discs.
  for (let i = 0; i < 12; i++) {
    const a=i*Math.PI/6, b=(i+1)*Math.PI/6;
    const p = (X: number, t: number): Point3 => [X,0.28+Math.sin(t)*0.27,z+Math.cos(t)*0.27];
    face('tyre-' + x + '-' + z + '-' + i,'car',[p(x+0.1,a),p(x+0.1,b),p(x,b),p(x,a)],'#252d35');
  }
  for (const end of [x,x+0.1]) {
    const rim: Point3[] = Array.from({length:12},(_,i)=>[end,0.28+Math.sin(i*Math.PI/6)*0.19,z+Math.cos(i*Math.PI/6)*0.19]);
    face('rim-' + end + '-' + z,'car',end===x?rim:[...rim].reverse(),'#b4bfc7');
  }
}
for (const x of [carX-0.5,carX+0.25]) box('headlamp-' + x,'car',[x,0.38,4.79],[x+0.25,0.43,4.82],'#e3f3f8');

export const HOME_CONDUITS: Record<Exclude<HomePart,'home'>, Point3[]> = {
  solar: [[2.63,3.62,0.4],[3.18,3.21,0.4],[3.18,1.95,-0.43]],
  battery: [[3.26,1.26,-0.43],[3.36,0.12,-0.43],[3.36,0.12,0.64],[3.34,0.45,0.64]],
  grid: [[3.26,1.26,-0.43],[3.42,0.05,-0.43],[4.52,0.05,-0.43],[4.52,0.12,0.53]],
  car: [[3.24,0.93,1.7],[3.3,0.08,2.6],[2.6,0.08,3.55],[1.77,0.38,3.55]],
};
function subtract(a: Point3, b: Point3): Point3 { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function dot(a: Point3,b: Point3) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a: Point3,b: Point3): Point3 { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function surfaceNormal(vertices: Point3[]): Point3 {
  const sum: [number,number,number]=[0,0,0];
  for(let i=1;i<vertices.length-1;i++) {
    const n=cross(subtract(vertices[i]!,vertices[0]!),subtract(vertices[i+1]!,vertices[0]!));
    for(let axis=0;axis<3;axis++) sum[axis]!+=n[axis]!;
  }
  return sum;
}

for (const [part,path] of Object.entries(HOME_CONDUITS) as [Exclude<HomePart,'home'>,Point3[]][]) {
  path.slice(1).forEach((end,index) => {
    const start=path[index]!, axis=subtract(end,start), count=Math.ceil(Math.hypot(...axis)*4);
    const perpendicular=cross(axis,Math.abs(axis[1])>0.9*Math.hypot(...axis)?[1,0,0]:[0,1,0]);
    const n=Math.hypot(...perpendicular), u=perpendicular.map(v=>v/n*0.018) as unknown as Point3;
    const orthogonal=cross(axis,u), m=Math.hypot(...orthogonal), v=orthogonal.map(value=>value/m*0.018) as unknown as Point3;
    const ring=(t:number)=>Array.from({length:4},(_,i)=>[0,1,2].map(a=>start[a]!+axis[a]!*t+u[a]!*Math.cos(i*Math.PI/2)+v[a]!*Math.sin(i*Math.PI/2)) as unknown as Point3);
    for(let step=0;step<count;step++) {
      const a=ring(step/count), b=ring((step+1)/count);
      for(let side=0;side<4;side++) {
        const next=(side+1)%4;
        faces.push({id:part+'-pipe-'+index+'-'+step+'-'+side,part,vertices:[a[side]!,a[next]!,b[next]!,b[side]!],color:'#80909c',flowProgress:(index+step/count)/(path.length-1)});
      }
    }
  });
}
export const HOME_MODEL: readonly ModelFace[] = faces;

type Partition = { normal: Point3; distance: number; faces: ModelFace[]; front: Partition | null; back: Partition | null };
// A static BSP splits crossing polygons in world space once. Traversing it from
// the camera guarantees occlusion (average-depth sorting hides lower windows
// behind tall cedar boards and fails when a large roof crosses another wall).
function partition(items: ModelFace[]): Partition | null {
  if (!items.length) return null;
  const first=items[0]!, normal=surfaceNormal(first.vertices);
  const length=Math.hypot(...normal);
  if(length<1e-8) return partition(items.slice(1));
  const unit=normal.map(value=>value/length) as unknown as Point3;
  const distance=dot(unit,first.vertices[0]!);
  const node: Partition={normal:unit,distance,faces:[],front:null,back:null}, front: ModelFace[]=[],back: ModelFace[]=[];
  for(const item of items) {
    const distances=item.vertices.map(p=>dot(unit,p)-distance);
    const positive=distances.some(value=>value>1e-6),negative=distances.some(value=>value< -1e-6);
    if(!positive && !negative) { node.faces.push(item); continue; }
    if(!negative) { front.push(item); continue; }
    if(!positive) { back.push(item); continue; }
    const f: Point3[]=[],b: Point3[]=[];
    item.vertices.forEach((point,i)=> {
      const d=distances[i]!,j=(i+1)%item.vertices.length,next=item.vertices[j]!,D=distances[j]!;
      if(d>= -1e-6) f.push(point);
      if(d<=1e-6) b.push(point);
      if((d>1e-6 && D< -1e-6)||(d< -1e-6 && D>1e-6)) {
        const t=d/(d-D), intersection=[0,1,2].map(axis=>point[axis]!+(next[axis]!-point[axis]!)*t) as unknown as Point3;
        f.push(intersection); b.push(intersection);
      }
    });
    if(f.length>=3) front.push({...item,id:item.id+'~f',vertices:f});
    if(b.length>=3) back.push({...item,id:item.id+'~b',vertices:b});
  }
  node.front=partition(front);node.back=partition(back);
  return node;
}
const MODEL_PARTITION=partition(faces);
function orderedFaces(eye: Point3) {
  const result: ModelFace[]=[];
  const visit=(node: Partition | null)=> {
    if(!node) return;
    const inFront=dot(node.normal,eye)>node.distance;
    visit(inFront?node.back:node.front);
    result.push(...node.faces);
    visit(inFront?node.front:node.back);
  };
  visit(MODEL_PARTITION);
  return result;
}
function view(camera: HomeCamera) {
  const yaw=(35+camera.x)*Math.PI/180, pitch=(27+camera.y)*Math.PI/180;
  const right: Point3=[Math.cos(yaw),0,-Math.sin(yaw)];
  const up: Point3=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),-Math.cos(yaw)*Math.sin(pitch)];
  const toward: Point3=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
  return {right,up,toward};
}
function projectWithView(point: Point3,camera: HomeCamera,{right,up,toward}: ReturnType<typeof view>) {
  const p=subtract(point,[0.7,1.65,1]);
  const depth=dot(p,toward), scale=68*camera.zoom*18/(18-depth);
  return {x:500+dot(p,right)*scale,y:345-dot(p,up)*scale,depth};
}
export function projectPoint(point: Point3,camera: HomeCamera) { return projectWithView(point,camera,view(camera)); }
export function projectHome(camera: HomeCamera): ProjectedFace[] {
  const basis=view(camera), {toward}=basis;
  const eye: Point3=[0.7+toward[0]*18,1.65+toward[1]*18,1+toward[2]*18];
  return orderedFaces(eye).flatMap((item) => {
    const normal=surfaceNormal(item.vertices);
    const magnitude=Math.hypot(...normal);
    if (magnitude<1e-8) return [];
    // Perspective-correct back-face culling, using the camera-to-face direction.
    const center: Point3=[0,1,2].map(axis=>item.vertices.reduce((sum,p)=>sum+p[axis]!,0)/item.vertices.length) as unknown as Point3;
    if(dot(normal,subtract(eye,center))<=0) return [];
    const points=item.vertices.map(p=>projectWithView(p,camera,basis));
    const light=0.66+0.34*Math.max(0,dot(normal,[-0.35,0.8,0.48])/magnitude);
    const channels=[1,3,5].map(start=>Math.round(parseInt(item.color.slice(start,start+2),16)*light));
    return [{...item,points:points.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),depth:points.reduce((sum,p)=>sum+p.depth,0)/points.length,fill:`rgb(${channels.join(',')})`}];
  });
}
