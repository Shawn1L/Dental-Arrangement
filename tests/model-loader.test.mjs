import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseModelGeometry } from '../src/model-loader.mjs';
const bufferOf = text => new TextEncoder().encode(text).buffer;
test('OBJ quads, negative indices and groups keep their coordinates',()=>{
  const text=readFileSync(new URL('./fixtures/upper.obj',import.meta.url),'utf8');
  const geometry=parseModelGeometry(bufferOf(text),'UPPER.OBJ');
  assert.equal(geometry.getAttribute('position').count/3,12);
  geometry.computeBoundingBox();
  assert.deepEqual(geometry.boundingBox.min.toArray(),[-10,-5,0]);
  assert.deepEqual(geometry.boundingBox.max.toArray(),[10,5,10]);
  geometry.dispose();
});
test('OBJ faces can include UVs, normals and material references without external requests',()=>{
  const geometry=parseModelGeometry(bufferOf('mtllib absent.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nusemtl tooth\nf 1/1/1 2/2/1 3/3/1\n'),'tooth.obj');
  assert.equal(geometry.getAttribute('position').count,3);
  assert.deepEqual(Object.keys(geometry.attributes),['position']);geometry.dispose();
});
test('empty, point-only, line-only and invalid OBJ faces are rejected',()=>{
  for(const text of ['', 'v 0 0 0\nv 1 0 0\nv 0 1 0', 'v 0 0 0\nv 1 0 0\nl 1 2', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99'])assert.throws(()=>parseModelGeometry(bufferOf(text),'bad.obj'));
  assert.throws(()=>parseModelGeometry(bufferOf('anything'),'bad.txt'));
});
test('STL still uses the same shared geometry import path',()=>{
  const geometry=parseModelGeometry(bufferOf('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t'),'tooth.stl');
  assert.equal(geometry.getAttribute('position').count,3);geometry.dispose();
});
