import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { validateSTL, inferJaw } from '../src/stl.mjs';
const arrayBuffer = b => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
test('actual upper and lower scans retain their common coordinate system',()=>{
  const boxes=[];
  for(const name of ['upper','lower']) {
    const buffer=arrayBuffer(readFileSync(new URL(`../public/demo/${name}.stl`,import.meta.url)));
    validateSTL(buffer);const geometry=new STLLoader().parse(buffer);geometry.computeBoundingBox();
    assert.ok(geometry.getAttribute('position').count>800000);boxes.push(geometry.boundingBox);geometry.dispose();
  }
  assert.ok(boxes[0].max.z>boxes[1].max.z);assert.ok(boxes[0].min.z>boxes[1].min.z);
});
test('ASCII STL is accepted',()=>{
  const b=new TextEncoder().encode('solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle');validateSTL(b.buffer);
  assert.equal(new STLLoader().parse(b.buffer).getAttribute('position').count,3);
});
test('reject corrupted, empty and nonfinite binary STL',()=>{
  assert.throws(()=>validateSTL(new ArrayBuffer(10)));assert.throws(()=>validateSTL(new ArrayBuffer(84)));
  const buffer=new ArrayBuffer(134);const view=new DataView(buffer);view.setUint32(80,1,true);view.setFloat32(96,NaN,true);assert.throws(()=>validateSTL(buffer));
  assert.throws(()=>validateSTL(new TextEncoder().encode('this is not an STL file').buffer));
});
test('detect jaws from Chinese and English filenames',()=>{
  assert.equal(inferJaw('上颌模型.stl'),'upper');assert.equal(inferJaw('lower.stl'),'lower');assert.equal(inferJaw('MAXILLA.stl'),'upper');assert.equal(inferJaw('part.stl'),'other');
});
