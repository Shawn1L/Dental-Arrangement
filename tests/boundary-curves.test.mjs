import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoundaryCurves } from '../src/boundary-curves.mjs';

test('shared chains are smoothed once with fixed controls and projected surface samples',()=>{
  const vertices=Array.from({length:21},(_,i)=>[i*.1,i===0||i===20?0:(i%2?.08:-.08),0]);
  const jaw={vertices},path=vertices.map((_,i)=>i),controls=new Set([0,10,20]);
  let projected=0;
  const curves=buildBoundaryCurves(jaw,[{key:1,loop:{vertices:path,closed:false}},{key:2,loop:{vertices:path.slice().reverse(),closed:false}}],controls,p=>{projected++;return [p[0],p[1],0];});
  assert.equal(curves.length,2);
  for(const curve of curves){
    assert.deepEqual(curve.keys,[1,2]);
    assert.ok(curve.points.every(p=>p[2]===0));
    assert.ok(curve.points.slice(1,-1).every(p=>Math.abs(p[1])<.08));
    const endpoint=curve.points.map((p,i)=>i===0||i===curve.points.length-1?p:undefined).filter(Boolean);
    for(const p of endpoint)assert.ok([...controls].some(v=>vertices[v].every((x,j)=>x===p[j])));
    const length=curve.points.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((x,j)=>x-curve.points[i][j])),0);
    assert.ok(length<1.2,'removes triangle-edge zigzags while preserving the one-unit span');
  }
  assert.ok(projected>0);
  assert.deepEqual([...controls],[0,10,20],'display samples never become editing controls');
});

test('owner changes and three-way junctions remain exact anchors',()=>{
  const jaw={vertices:[[0,0,0],[1,.2,0],[2,0,0],[1,1,0]]};
  const curves=buildBoundaryCurves(jaw,[{key:1,loop:{vertices:[0,1,2],closed:false}},{key:2,loop:{vertices:[0,1,3],closed:false}}],new Set(),p=>p);
  assert.equal(curves.length,3);
  assert.equal(curves.filter(c=>c.keys.length===2).length,1);
  for(const c of curves)assert.ok([c.points[0],c.points.at(-1)].some(p=>p.every((x,j)=>x===jaw.vertices[1][j])));
});
