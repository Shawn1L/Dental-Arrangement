import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { estimateArchFrame, sampleSurface } from '../src/arch-orientation.mjs';

function arch(segments=80, sections=16) {
  const p=(i,j)=>{const t=-1.9+3.8*i/segments,f=Math.PI*j/sections;return [(25+3*Math.cos(f))*Math.sin(t),3*Math.sin(f),(25+3*Math.cos(f))*Math.cos(t)];};
  const triangles=[];
  for(let i=0;i<segments;i++)for(let j=0;j<sections;j++) {
    const a=p(i,j),b=p(i+1,j),c=p(i+1,j+1),d=p(i,j+1);triangles.push(...a,...b,...d,...b,...c,...d);
  }
  return new Float64Array(triangles);
}
const dot=(a,b)=>new Vector3(...a).dot(new Vector3(...b));
function move(positions,q,translation=new Vector3()) {
  const result=new Float64Array(positions.length);
  for(let i=0;i<positions.length;i+=3)result.set(new Vector3(...positions.subarray(i,i+3)).applyQuaternion(q).add(translation).toArray(),i);
  return result;
}

test('unlabelled arch geometry resolves anterior, superior and patient right',()=>{
  const result=estimateArchFrame([{positions:arch(),jaw:'lower'}]);assert.ok(result.frame,result.reason);
  assert.ok(dot(result.frame.front,[0,0,1])>.99);
  assert.ok(dot(result.frame.up,[0,1,0])>.99);
  assert.ok(dot(result.frame.right,[-1,0,0])>.99);
});

test('arbitrary rigid rotations and translations preserve all anatomical axes',()=>{
  const positions=arch(),original=estimateArchFrame([{positions,jaw:'lower'}]).frame;
  for(let trial=0;trial<8;trial++) {
    const q=new Quaternion().setFromAxisAngle(new Vector3(.2+trial,.7,.4).normalize(),trial*.71);
    const result=estimateArchFrame([{positions:move(positions,q,new Vector3(150,-80,31)),jaw:'lower'}]);assert.ok(result.frame,result.reason);
    for(const axis of ['front','up','right'])assert.ok(dot(result.frame[axis],new Vector3(...original[axis]).applyQuaternion(q).toArray())>1-1e-8);
  }
});

test('area sampling resists uneven remeshing and leaves source positions unchanged',()=>{
  const source=arch(20,8),before=source.slice(),original=estimateArchFrame([{positions:source,jaw:'lower'}]);
  const subdivided=[];
  for(let i=0;i<source.length;i+=9) {
    const a=Array.from(source.subarray(i,i+3)),b=Array.from(source.subarray(i+3,i+6)),c=Array.from(source.subarray(i+6,i+9));
    if(a[0]<0) {
      const ab=a.map((x,k)=>(x+b[k])/2),bc=b.map((x,k)=>(x+c[k])/2),ca=c.map((x,k)=>(x+a[k])/2);
      subdivided.push(...a,...ab,...ca,...ab,...b,...bc,...ca,...bc,...c,...ab,...bc,...ca);
    } else subdivided.push(...a,...b,...c);
  }
  const remeshed=estimateArchFrame([{positions:subdivided,jaw:'lower'}]);assert.ok(remeshed.frame);
  assert.ok(dot(original.frame.front,remeshed.frame.front)>.999);
  assert.deepEqual(source,before);
  assert.equal(sampleSurface(source,500).points.length,500);
});

test('paired closed arches resolve up from jaw positions; ambiguous single scans require calibration',()=>{
  const source=arch(),closed=new Float64Array(source.length*2);closed.set(source);
  for(let i=0;i<source.length;i+=9)closed.set([...source.subarray(i,i+3),...source.subarray(i+6,i+9),...source.subarray(i+3,i+6)],source.length+i);
  assert.equal(estimateArchFrame([{positions:closed,jaw:'lower'}]).frame,null);
  assert.equal(estimateArchFrame([{positions:source,jaw:'other'}]).frame,null);
  const upper=move(closed,new Quaternion(),new Vector3(0,12,0));
  const result=estimateArchFrame([{positions:closed,jaw:'lower'},{positions:upper,jaw:'upper'}]);
  assert.ok(result.frame,result.reason);assert.ok(dot(result.frame.up,[0,1,0])>.99);
});

test('degenerate surfaces and non-arch planar rectangles fail without a guessed direction',()=>{
  for(const positions of [[],new Float32Array(9),[0,0,0,1,0,0,1,0,1,0,0,0,1,0,1,0,0,1]])assert.equal(estimateArchFrame([{positions,jaw:'lower'}]).frame,null);
});
