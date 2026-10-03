import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_MODEL, projectHome, projectPoint } from './home-model.ts';
import { constrainCamera, defaultCamera } from './home-camera.ts';

test('orbit reveals different building faces and hides the opposite elevation', () => {
  const ids = camera => new Set(projectHome(camera).map(face => face.id.split('~')[0]));
  const front = ids(defaultCamera);
  const side = ids({ ...defaultCamera, x: -75 });
  const rear = ids({ ...defaultCamera, x: 100 });
  assert.ok(front.has('main-front') && front.has('main-right'));
  assert.ok(!front.has('main-back') && !front.has('main-left'));
  assert.ok(side.has('main-left') && !side.has('main-right'));
  assert.ok(rear.has('main-back') && !rear.has('main-front'));
  assert.ok(front.has('car-roof') && front.has('car-bonnet'));
  assert.ok(front.has('solar-0-0'));
});
test('vertices at different depths move differently: the scene is volumetric', () => {
  const front = [0,1,2], back = [0,1,-2];
  const a = { ...defaultCamera, x: -35 }, b = { ...defaultCamera, x: 35 };
  const travel = p => projectPoint(p,b).x-projectPoint(p,a).x;
  assert.ok(Math.abs(travel(front)-travel(back)) > 200);
  assert.notEqual(projectPoint(front,a).depth, projectPoint(back,a).depth);
});
test('all camera extremes produce finite model and conduit geometry without duplicate surfaces', () => {
  assert.equal(new Set(HOME_MODEL.map(face => face.id)).size, HOME_MODEL.length);
  for (const x of [-100,0,100]) for (const y of [-12,0,24]) for (const zoom of [0.9,1.45]) {
    const camera = constrainCamera({x,y,zoom});
    const faces = projectHome(camera);
    assert.ok(faces.length > 0);
    assert.ok(faces.every(face => Number.isFinite(face.depth) && !/NaN|Infinity/.test(face.points)));
    assert.equal(new Set(faces.map(face => face.id)).size, faces.length);
    assert.ok(faces.some(face => face.flowProgress !== undefined));
    assert.ok(faces.every(face => face.flowProgress === undefined || (face.flowProgress >= 0 && face.flowProgress <= 1)));
    assert.ok(new Set(faces.map(face => face.part)).has('home'));
  }
});

test('near windows occlude cedar cladding even when the wall has a nearer average depth', () => {
  const faces=projectHome(defaultCamera);
  const contains=(face,point)=> {
    const vertices=face.points.split(' ').map(pair=>pair.split(',').map(Number));
    let inside=false;
    for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
      const [x,y]=vertices[i], [X,Y]=vertices[j];
      if((y>point.y)!==(Y>point.y) && point.x<(X-x)*(point.y-y)/(Y-y)+x) inside=!inside;
    }
    return inside;
  };
  for(const [point,id] of [[[1,0.8,2.214],'main-lower'],[[-2.4,0.8,0.804],'wing-lower'],[[1,2.5,2.214],'main-upper']]) {
    const projected=projectPoint(point,defaultCamera);
    const visible=faces.filter(face=>contains(face,projected)).at(-1);
    assert.ok(visible?.id.startsWith(id), 'Expected '+id+', got '+visible?.id);
  }
});
test('all energy targets have independent volumes with complete opposite faces', () => {
  for (const part of ['home','solar','battery','grid','car']) {
    assert.ok(HOME_MODEL.filter(face => face.part === part).length >= 6);
  }
  for (const id of ['main','wing','battery','grid']) {
    assert.ok(HOME_MODEL.some(face => face.id === id+'-back'));
    assert.ok(HOME_MODEL.some(face => face.id === id+'-front'));
  }
});
test('initial and reset framing includes the full building, equipment and ground', () => {
  for(const face of projectHome(defaultCamera)) for(const pair of face.points.split(' ')) {
    const [x,y]=pair.split(',').map(Number);
    assert.ok(x>=0 && x<=1000 && y>=0 && y<=700,'Initial framing cropped '+face.id);
  }
});
