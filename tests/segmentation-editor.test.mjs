import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditableJaw,regionCenters,activeRegions,boundaryLoops,controlIndices,moveBoundary,applyLasso,renumber,setMark,deleteRegion,EditSession} from '../src/segmentation-editor.mjs';
import {isTooth,toothColor} from '../src/segmentation.mjs';

function grid(z=0) {
  const p=[],ids=[];
  for(let y=0;y<12;y++)for(let x=0;x<12;x++)for(const triangle of [[[x,y,z],[x+1,y,z],[x+1,y+1,z]],[[x,y,z],[x+1,y+1,z],[x,y+1,z]]]) {
    p.push(...triangle.flat());ids.push(y>=3&&y<9?(x>=3&&x<8?11:x>=8&&x<11?12:0):0);
  }
  return createEditableJaw(new Float32Array(p),new Uint16Array(ids));
}
test('surface topology preserves geometry and produces closed region boundaries',()=>{
  const jaw=grid(),original=jaw.positions.slice(),loops=boundaryLoops(jaw,1);
  assert.equal(loops.length,1);assert.equal(loops[0].closed,true);assert.ok(controlIndices(jaw,loops[0]).length>=3);
  deleteRegion(jaw,1);assert.deepEqual(jaw.positions,original);assert.ok(!activeRegions(jaw).has(1));assert.equal(regionCenters(jaw).length,1);
});
test('FDI children and permanent teeth use corresponding quadrant palettes',()=>{
  for(const n of [11,48,51,65,71,85])assert.equal(isTooth(n),true);
  for(const n of [19,49,56,66,70,86,99])assert.equal(isTooth(n),false);
  assert.equal(toothColor(11),toothColor(31));assert.equal(toothColor(21),toothColor(41));assert.equal(toothColor(51),toothColor(71));
});
test('number swaps and S conversions retain region identity and B/I markers',()=>{
  const jaw=grid(),labels=jaw.labels.slice();setMark(jaw,1,'B');renumber(jaw,1,12);
  assert.equal(jaw.regions[1].number,12);assert.equal(jaw.regions[2].number,11);assert.equal(jaw.regions[1].mark,'B');
  setMark(jaw,1,'I');assert.equal(jaw.regions[1].mark,'I');setMark(jaw,1,'I');assert.equal(jaw.regions[1].mark,null);
  setMark(jaw,1,'B');setMark(jaw,1,'S');assert.equal(jaw.regions[1].number,null);assert.equal(regionCenters(jaw).find(t=>t.key===1).id,'S');
  renumber(jaw,1,51);assert.equal(jaw.regions[1].mark,'B');assert.equal(jaw.regions[1].number,51);assert.deepEqual(jaw.labels,labels);
});
test('S taking an occupied number exchanges identities without restoring an old FDI',()=>{
  const jaw=grid();setMark(jaw,1,'S');renumber(jaw,1,12);
  assert.equal(jaw.regions[1].number,12);assert.equal(jaw.regions[2].number,null);
});
test('lasso overwrites other regions, subtracts only the target and ignores gum starts',()=>{
  const jaw=grid(),project=p=>[p[0],p[1],0],polygon=[[7,4],[10,4],[10,8],[7,8]];
  const original=jaw.labels.slice();assert.equal(applyLasso(jaw,0,polygon,false,project),false);assert.deepEqual(jaw.labels,original);
  assert.equal(applyLasso(jaw,1,polygon,false,project),true);
  const f=Array.from(jaw.labels.keys()).find(f=>jaw.centers[f*3]>9&&jaw.centers[f*3]<10&&jaw.centers[f*3+1]>5&&jaw.centers[f*3+1]<6);
  assert.equal(original[f],2);assert.equal(jaw.labels[f],1);
  applyLasso(jaw,1,polygon,true,project);assert.equal(jaw.labels[f],0);assert.ok(jaw.labels.includes(2));
  assert.ok(boundaryLoops(jaw,1).length);
});
test('lasso affects front and back faces sharing the projection',()=>{
  const front=grid(1),back=grid(-1),positions=new Float32Array([...front.positions,...back.positions]);
  const jaw=createEditableJaw(positions,new Uint32Array([...front.labels,...back.labels].map(key=>key?front.regions[key].number:0)));
  const n=front.labels.length;applyLasso(jaw,1,[[7,4],[10,4],[10,8],[7,8]],false,p=>[p[0],p[1],p[2]*.5]);
  assert.deepEqual(jaw.labels.slice(0,n),jaw.labels.slice(n));assert.notDeepEqual(jaw.labels.slice(n),back.labels);
});
function shrinkShared(jaw,separate) {
  const loop=boundaryLoops(jaw,1)[0],index=controlIndices(jaw,loop).find(i=>jaw.vertices[loop.vertices[i]].join(',')==='8,6,0');
  assert.notEqual(index,undefined);return moveBoundary(jaw,1,loop,index,[7,6,0],separate);
}
test('surface drag updates ownership, linked boundary and area without moving mesh vertices',()=>{
  const jaw=grid(),positions=jaw.positions.slice(),before=jaw.labels.slice(),neighbor=before.filter(x=>x===2).length;
  assert.equal(shrinkShared(jaw,false),true);assert.ok(jaw.labels.filter(x=>x===2).length>neighbor);
  assert.ok(jaw.labels.filter(x=>x===1).length<before.filter(x=>x===1).length);assert.deepEqual(jaw.positions,positions);
  for(const key of [1,2])assert.ok(boundaryLoops(jaw,key).every(l=>l.closed));
});
test('separating shared boundary creates lasting gum gap without changing neighbor',()=>{
  const jaw=grid(),before=jaw.labels.slice(),neighborControls=()=>boundaryLoops(jaw,2).flatMap(loop=>controlIndices(jaw,loop).map(i=>loop.vertices[i]));const anchors=neighborControls();assert.equal(shrinkShared(jaw,true),true);assert.deepEqual(neighborControls(),anchors,'separation preserves neighbor control positions');
  before.forEach((id,f)=>{if(id===2)assert.equal(jaw.labels[f],2);});
  assert.ok(jaw.labels.some((id,f)=>id===0&&before[f]===1));
});
test('whole-jaw history restores ownership, swaps, marks and clears redo on new edits',()=>{
  const upper=grid(),lower=grid(),session=new EditSession([upper,lower]),original=session.snapshot();
  session.edit(()=>{shrinkShared(upper,false);renumber(upper,1,12);setMark(lower,2,'S');});
  const changed=session.snapshot();assert.equal(session.undoStack.length,1);session.undo();
  assert.deepEqual(session.snapshot(),original);session.redo();assert.deepEqual(session.snapshot(),changed);
  session.undo();session.edit(()=>deleteRegion(lower,2));assert.equal(session.redoStack.length,0);session.undo();assert.deepEqual(session.snapshot(),original);
  session.redo();session.reset();assert.deepEqual(session.snapshot(),original);assert.equal(session.undoStack.length,0);assert.equal(session.redoStack.length,0);
});
test('new session baseline retains previous saved edits when reset or cancelled',()=>{
  const jaw=grid(),first=new EditSession([jaw]);first.edit(()=>{renumber(jaw,1,51);setMark(jaw,1,'B');});
  const saved=first.snapshot(),second=new EditSession([jaw]);assert.equal(second.undoStack.length,0);second.edit(()=>deleteRegion(jaw,1));second.reset();assert.deepEqual(second.snapshot(),saved);
});

test('history reports only affected jaws and face identities for incremental rendering',()=>{
  const upper=grid(),lower=grid(),session=new EditSession([upper,lower]);
  session.edit(()=>deleteRegion(lower,2));
  assert.equal(session.lastChanges.length,1);const patch=session.lastChanges[0];
  assert.equal(patch.j,1);assert.ok(patch.indices.length);assert.ok(patch.old.every(k=>k===2));assert.ok(patch.next.every(k=>k===0));
  session.undo();assert.strictEqual(session.lastChanges[0],patch);assert.ok(lower.labels.includes(2));
  session.redo();assert.strictEqual(session.lastChanges[0],patch);assert.ok(!lower.labels.includes(2));
  assert.equal(session.edit(()=>{}),false);assert.deepEqual(session.lastChanges,[]);
  session.edit(()=>renumber(upper,1,12));assert.equal(session.lastChanges[0].j,0);assert.equal(session.lastChanges[0].indices.length,0);
  assert.equal(session.lastChanges[0].before[1].number,11);assert.equal(session.lastChanges[0].after[1].number,12);
});


test('boundary handle counts grow with arc length and stay between 20 and 25',()=>{
  const counts=[];
  for(const radius of [5,8,12]){
    const positions=[],labels=[];
    for(let i=0;i<120;i++){
      const a=i*Math.PI/60,b=(i+1)*Math.PI/60;
      positions.push(0,0,0,radius*Math.cos(a),radius*Math.sin(a),0,radius*Math.cos(b),radius*Math.sin(b),0);labels.push(11);
    }
    // Reuse exactly the same Float32 endpoint at the circular seam.
    positions.splice(positions.length-3,3,...positions.slice(3,6));
    const jaw=createEditableJaw(new Float32Array(positions),new Uint16Array(labels)),loop=boundaryLoops(jaw,1)[0];
    const indices=controlIndices(jaw,loop);counts.push(indices.length);
    assert.ok(indices.length>=20&&indices.length<=25);
    assert.equal(new Set(indices.map(i=>loop.vertices[i])).size,indices.length);
  }
  assert.ok(counts[0]<counts[1]&&counts[1]<counts[2]);
});

test('adjacent loops share exactly the same control vertices regardless of traversal direction',()=>{
  const jaw=grid(),a=boundaryLoops(jaw,1)[0],b=boundaryLoops(jaw,2)[0];
  const shared=new Set(a.vertices.filter(v=>b.vertices.includes(v)));
  const controls=loop=>controlIndices(jaw,loop).map(i=>loop.vertices[i]);
  const left=controls(a).filter(v=>shared.has(v)).sort((a,b)=>a-b),right=controls(b).filter(v=>shared.has(v)).sort((a,b)=>a-b);
  assert.ok(left.length>=2);assert.deepEqual(left,right);
  const reversed={key:b.key,vertices:[...b.vertices].reverse(),closed:true};
  assert.deepEqual(controls(reversed).sort((a,b)=>a-b),controls(b).sort((a,b)=>a-b));
});

test('control sampling follows boundary edits, undo, redo and reset',()=>{
  const jaw=grid(),session=new EditSession([jaw]);
  const controls=()=>[1,2].map(key=>boundaryLoops(jaw,key).map(loop=>controlIndices(jaw,loop).map(i=>loop.vertices[i])));
  const initial=controls();session.edit(()=>shrinkShared(jaw,false));const moved=controls();assert.notDeepEqual(moved,initial);
  session.undo();assert.deepEqual(controls(),initial);session.redo();assert.deepEqual(controls(),moved);session.reset();assert.deepEqual(controls(),initial);
});


test('extending a dragged boundary reuses existing control points without adding handles',()=>{
  const jaw=grid(),session=new EditSession([jaw]);
  const counts=()=>[1,2].map(key=>new Set(boundaryLoops(jaw,key).flatMap(loop=>controlIndices(jaw,loop).map(i=>loop.vertices[i]))).size);
  const loops=boundaryLoops(jaw,1),loop=loops[0],indices=controlIndices(jaw,loop),index=indices.find(i=>jaw.vertices[loop.vertices[i]].join(',')==='8,6,0');
  const initial=counts(),length=l=>l.vertices.slice(1).reduce((sum,v,i)=>sum+Math.hypot(...jaw.vertices[v].map((x,j)=>x-jaw.vertices[l.vertices[i]][j])),0);
  const oldLength=length(loop);assert.notEqual(index,undefined);
  assert.equal(session.edit(()=>moveBoundary(jaw,1,loop,index,[9,6,0])),true);
  assert.ok(length(boundaryLoops(jaw,1)[0])>oldLength,'the curve became longer');
  const moved=counts();moved.forEach((n,i)=>assert.ok(n<=initial[i],'drag does not add handles on either tooth'));
  const a=boundaryLoops(jaw,1)[0],b=boundaryLoops(jaw,2)[0],shared=new Set(a.vertices.filter(v=>b.vertices.includes(v)));
  const common=l=>controlIndices(jaw,l).map(i=>l.vertices[i]).filter(v=>shared.has(v)).sort((a,b)=>a-b);
  assert.deepEqual(common(a),common(b),'shared handles remain aligned after extension');
  session.undo();assert.deepEqual(counts(),initial);session.redo();assert.deepEqual(counts(),moved);
});
