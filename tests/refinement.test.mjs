import test from 'node:test';
import assert from 'node:assert/strict';
import { objTopology, expandedGeometry, packRefinement, decodeRefinement, refineSegmentation } from '../src/segmentation-refinement.mjs';
import { clearModels } from '../src/model-import.mjs';

test('OBJ original topology survives interleaved groups and negative polygon indices', async () => {
  const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\ng A\nf 1 2 3\ng B\nf -4 -2 -1\ng A\nf 1 3 4';
  const topology = objTopology(new TextEncoder().encode(text).buffer);
  assert.deepEqual([...topology.faces], [0,1,2,0,2,3,0,2,3]);
  const geometry = expandedGeometry(topology);
  const packed = await packRefinement(geometry.attributes.position.array, { labels: [0,11,11,0] }, topology).arrayBuffer();
  assert.deepEqual([...new Uint32Array(packed,0,3)], [1,4,3]);
  assert.deepEqual([...new Uint16Array(packed,12+48+36,4)], [0,11,11,0]);
  geometry.dispose();
});

test('expanded topology welds exact duplicates but rejects conflicting labels', async () => {
  const positions = new Float32Array([0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0]);
  const packed = await packRefinement(positions,{labels:[0,11,0,11,11,0]}).arrayBuffer();
  assert.deepEqual([...new Uint32Array(packed,0,3)], [1,4,2]);
  assert.throws(() => packRefinement(positions,{labels:[0,11,0,21,11,0]}), /冲突/);
  assert.throws(() => packRefinement(positions,{labels:[0,0,0,0,0,0]}), /FDI/);
});

test('binary response colors faces uniformly and uses area-weighted tooth centers', () => {
  let header = JSON.stringify({version:1,faces:2}); header += ' '.repeat((4-header.length%4)%4);
  const encoded = new TextEncoder().encode(header), buffer = new ArrayBuffer(4+encoded.length+148);
  new DataView(buffer).setUint32(0,encoded.length,true);new Uint8Array(buffer,4,encoded.length).set(encoded);
  const offset = encoded.length+4;
  new Float32Array(buffer,offset,18).set([0,0,0,2,0,0,0,2,0,10,0,0,11,0,0,10,1,0]);
  new Float32Array(buffer,offset+72,18).fill(1);new Uint16Array(buffer,offset+144,2).fill(11);
  const result=decodeRefinement(buffer);
  assert.deepEqual([...result.faceLabels],[11,11]);
  new Uint16Array(buffer,offset+144,2)[0]=0;
  assert.equal(result.faceLabels[0],11,'editable ownership must not alias the response buffer');
  assert.equal(result.teeth.length,1);
  assert.ok(Math.abs(result.teeth[0].center[0]-(2*(2/3)+.5*(31/3))/2.5)<1e-10);
  assert.deepEqual([...result.geometry.attributes.color.array.slice(0,3)], [...result.geometry.attributes.color.array.slice(3,6)]);
  assert.throws(()=>decodeRefinement(buffer.slice(0,-1)),/数量/);
  result.geometry.dispose();
});

test('clearing models disposes retained source and refined geometries exactly once', () => {
  let source=0,refined=0,material=0;
  const a={dispose(){source++;}}, b={dispose(){refined++;}};
  const models=[{source:a,refined:b,mesh:{geometry:b,material:{dispose(){material++;}}}}];
  clearModels({remove(){}},models);
  assert.equal(source,1);assert.equal(refined,1);assert.equal(material,1);assert.equal(models.length,0);
});

test('refinement uses local endpoint, forwards cancellation and exposes service errors', async () => {
  const originalFetch=globalThis.fetch, abort=new AbortController();
  const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);
  try {
    globalThis.fetch=async (url,options)=>{
      assert.equal(url,'/api/segmentation/refine');
      assert.equal(options.signal,abort.signal);
      assert.ok(options.body instanceof Blob);
      return {ok:false,json:async()=>({detail:'几何覆盖失败'})};
    };
    await assert.rejects(refineSegmentation(positions,{labels:[0,11,11]},undefined,abort.signal),/几何覆盖失败/);
    globalThis.fetch=async ()=>{throw new DOMException('Aborted','AbortError');};
    await assert.rejects(refineSegmentation(positions,{labels:[0,11,11]},undefined,abort.signal),{name:'AbortError'});
  } finally {globalThis.fetch=originalFetch;}
});
