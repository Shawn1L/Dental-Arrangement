import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import { toothColor, labelGeometry, objVertexMap } from '../src/segmentation.mjs';
const triangle = () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3));

test('FDI colors follow the opposing upper/lower quadrants in the reference', () => {
  for(let i=1;i<=8;i++){
    assert.equal(toothColor(10+i),toothColor(30+i));
    assert.equal(toothColor(20+i),toothColor(40+i));
    assert.notEqual(toothColor(10+i),toothColor(20+i));
  }
  assert.equal(toothColor(0),'#c7a775');
});
test('OBJ labels retain source vertex order across polygon triangulation and negative indices', () => {
  const map=objVertexMap(new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n').buffer);
  assert.equal(map.count,4);assert.deepEqual([...map.indices],[0,1,2,0,2,3]);
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0],3));
  const teeth=labelGeometry(geometry,{labels:[11,0,21,21]},map);
  assert.deepEqual(teeth.map(t=>t.id),[11,21]);
  const expected=new Color(toothColor(21));const colors=geometry.getAttribute('color');
  assert.ok(Math.abs(colors.getX(2)-expected.r)<1e-6);geometry.dispose();
});
test('invalid labels fail before applying any colors to the uploaded mesh',()=>{
  const geometry=triangle();
  for(const labels of [[11],[11,21,99],[11,21,NaN]])assert.throws(()=>labelGeometry(geometry,{labels}));
  assert.equal(geometry.getAttribute('color'),undefined);
  const teeth=labelGeometry(geometry,{labels:[11,11,0]});assert.deepEqual(teeth,[{id:11,center:[.5,0,0]}]);geometry.dispose();
});

test('validation accepts deciduous FDI and explains exact allowed ranges',()=>{
  const geometry=triangle();assert.equal(labelGeometry(geometry,{labels:[51,65,85]}).length,3);
  for(const id of [19,56,66,86])assert.throws(()=>labelGeometry(geometry,{labels:[id,0,0]}),/恒牙 11–18.*乳牙 51–55.*81–85/);
  geometry.dispose();
});
