// Offline QA only: labels supply an independent reference AFTER geometry fitting.
// Production arch-orientation.mjs never reads labels or imports this script.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Quaternion, Vector3 } from 'three';
import { objTopology, expandedGeometry } from '../src/segmentation-refinement.mjs';
import { estimateArchFrame, sampleSurface } from '../src/arch-orientation.mjs';

const catalog=JSON.parse(await readFile(new URL('../src/preloaded-cases.json',import.meta.url),'utf8'));
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,new Vector3(...a).normalize().dot(new Vector3(...b).normalize()))))*180/Math.PI;
const results=[];
for(const item of catalog) {
  const surfaces=[],references=[];
  for(const entry of item.entries) {
    const root=new URL(`../public/preloaded/${item.id}/`,import.meta.url);
    const bytes=await readFile(new URL(entry.model,root));
    const topology=objTopology(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const geometry=expandedGeometry(topology);
    surfaces.push({positions:geometry.getAttribute('position').array,jaw:entry.jaw});geometry.dispose();
    const {labels}=JSON.parse(await readFile(new URL(entry.result,root),'utf8'));
    const teeth=new Map();
    labels.forEach((id,i)=>{if(!id)return;const value=teeth.get(id)||{sum:new Vector3(),n:0};value.sum.add(new Vector3(...topology.vertices.subarray(i*3,i*3+3)));value.n++;teeth.set(id,value);});
    const anterior=new Vector3(),posterior=new Vector3();let na=0,np=0;
    for(const [id,t] of teeth) {t.sum.divideScalar(t.n);if(id%10<=2){anterior.add(t.sum);na++;}if(id%10>=6){posterior.add(t.sum);np++;}}
    if(na&&np)references.push(anterior.divideScalar(na).sub(posterior.divideScalar(np)).normalize());
  }
  const started=performance.now(), result=estimateArchFrame(surfaces), elapsedMs=performance.now()-started;
  assert.ok(result.frame,`${item.id}: ${result.reason}`);
  const expected=references.reduce((s,v)=>s.add(v),new Vector3()).normalize();
  const frontError=angle(result.frame.front,expected.toArray());
  assert.ok(frontError<20,`${item.id}: anterior error ${frontError.toFixed(1)}°`);
  let maxRotationError=0;
  for(let trial=0;trial<3;trial++) {
    const q=new Quaternion().setFromAxisAngle(new Vector3(.31+trial,.83-trial*.1,.47).normalize(),.7+trial*1.4);
    const moved=surfaces.map(s=>{const positions=new Float64Array(s.positions.length);for(let i=0;i<positions.length;i+=3){const p=new Vector3(...s.positions.subarray(i,i+3)).applyQuaternion(q).add(new Vector3(137,-83,29));positions.set(p.toArray(),i);}return {...s,positions};});
    const rotated=estimateArchFrame(moved);assert.ok(rotated.frame,`${item.id}: rotated estimate failed`);
    for(const key of ['front','up','right'])maxRotationError=Math.max(maxRotationError,angle(rotated.frame[key],new Vector3(...result.frame[key]).applyQuaternion(q).toArray()));
  }
  assert.ok(maxRotationError<.1,`${item.id}: rotation error ${maxRotationError}°`);
  // Refine only one side of each actual scan, without changing its surface.
  // This deliberately changes vertex/face density asymmetrically.
  const refined=surfaces.map(surface=>{
    const source=surface.positions, positions=new Float64Array(source.length*2);let out=0;
    const right=new Vector3(...result.frame.right);
    const center=sampleSurface(source,1000).points.reduce((sum,p)=>sum.add(new Vector3(...p)),new Vector3()).divideScalar(1000);
    for(let i=0;i<source.length;i+=9) {
      const a=new Vector3(...source.subarray(i,i+3)),b=new Vector3(...source.subarray(i+3,i+6)),c=new Vector3(...source.subarray(i+6,i+9));
      if(a.clone().add(b).add(c).divideScalar(3).sub(center).dot(right)>0) {
        const midpoint=b.clone().add(c).multiplyScalar(.5);
        positions.set([...a.toArray(),...b.toArray(),...midpoint.toArray(),...a.toArray(),...midpoint.toArray(),...c.toArray()],out);out+=18;
      } else {positions.set(source.subarray(i,i+9),out);out+=9;}
    }
    return {...surface,positions:positions.subarray(0,out)};
  });
  const remeshed=estimateArchFrame(refined);assert.ok(remeshed.frame,`${item.id}: remeshing estimate failed`);
  const maxRemeshingError=Math.max(...['front','up','right'].map(key=>angle(remeshed.frame[key],result.frame[key])));
  assert.ok(maxRemeshingError<2,`${item.id}: remeshing error ${maxRemeshingError}°`);
  const row={case:item.id,elapsedMs:+elapsedMs.toFixed(1),frontErrorDegrees:+frontError.toFixed(2),maxRotationErrorDegrees:+maxRotationError.toFixed(5),maxRemeshingErrorDegrees:+maxRemeshingError.toFixed(3)};
  results.push(row);console.log(row);
}
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
await writeFile(new URL('../test-results/arch-orientation-validation.json',import.meta.url),JSON.stringify(results,null,2));
console.log(`Validated ${results.length} cases, ${results.length*3} rotated pairs and ${results.length} remeshed pairs; no labels were passed to the estimator.`);
