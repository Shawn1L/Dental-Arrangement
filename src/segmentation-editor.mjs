// Editable ownership uses stable region keys; FDI numbers are metadata, never keys.
import { isTooth } from './segmentation.mjs';
export const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
export function createEditableJaw(positions, labels) {
  if (positions.length !== labels.length * 9) throw new Error('编辑面片与标签数量不匹配');
  const vertices = [], faces = new Uint32Array(labels.length * 3), lookup = new Map();
  const vertexFaces = [], neighbors = [], edges = new Map();
  for (let i = 0; i < faces.length; i++) {
    const p = Array.from(positions.subarray(i * 3, i * 3 + 3));
    // Refinement emits repeated Float32 triangle corners. Weld only identical
    // coordinates; proximity welding can collapse narrow refined boundary faces.
    const key = p.join(',');
    let v = lookup.get(key);
    if (v === undefined) { v = vertices.length; lookup.set(key, v); vertices.push(p); vertexFaces.push([]); neighbors.push(new Set()); }
    faces[i] = v; vertexFaces[v].push(Math.floor(i / 3));
  }
  const centers = new Float32Array(labels.length * 3), areas = new Float64Array(labels.length);
  for (let f = 0; f < labels.length; f++) {
    const ids = Array.from(faces.subarray(f * 3, f * 3 + 3)), [a,b,c] = ids.map(v => vertices[v]);
    for (let j=0;j<3;j++) centers[f*3+j]=(a[j]+b[j]+c[j])/3;
    const u=b.map((x,j)=>x-a[j]), v=c.map((x,j)=>x-a[j]);
    areas[f]=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
    for (let j=0;j<3;j++) {
      const a=ids[j], b=ids[(j+1)%3], key=edgeKey(a,b);
      if (!edges.has(key)) edges.set(key,{a,b,faces:[]});
      edges.get(key).faces.push(f); neighbors[a].add(b); neighbors[b].add(a);
    }
  }
  const faceNeighbors = Array.from({length:labels.length},()=>[]);
  for (const [key,e] of edges) for (const a of e.faces) for (const b of e.faces) if(a!==b) faceNeighbors[a].push({face:b,key});
  const numbers=[...new Set(labels)].filter(Boolean).sort((a,b)=>a-b);
  const identities=new Map(numbers.map((number,i)=>[number,i+1]));
  return { positions, vertices, faces, vertexFaces, neighbors:neighbors.map(s=>[...s]), edges, faceNeighbors, centers, areas,
    labels:Uint32Array.from(labels,id=>identities.get(id)||0), regions:Object.fromEntries(numbers.map((number,i)=>[i+1,{number,mark:null}])) };
}
export function activeRegions(jaw) { const keys=new Set(jaw.labels);keys.delete(0);return keys; }
export function regionCenters(jaw) {
  const sums=new Map();
  jaw.labels.forEach((id,f)=>{if(!id)return;const t=sums.get(id)||{key:id,center:[0,0,0],area:0};const area=jaw.areas[f];t.area+=area;for(let j=0;j<3;j++)t.center[j]+=jaw.centers[f*3+j]*area;sums.set(id,t);});
  return [...sums.values()].filter(t=>t.area>0).map(t=>({key:t.key,id:jaw.regions[t.key].number??'S',mark:jaw.regions[t.key].mark,center:t.center.map(x=>x/t.area)}));
}
export function renumber(jaw,key,number) {
  if(!jaw.regions[key]||!isTooth(number))return;
  const other=[...activeRegions(jaw)].find(k=>k!==key&&jaw.regions[k].number===number);
  if(other!==undefined)jaw.regions[other].number=jaw.regions[key].number;
  jaw.regions[key].number=number;
}
export function setMark(jaw,key,mark) {
  const region=jaw.regions[key];if(!region)return;
  if(mark==='S')region.number=null;
  else region.mark=region.mark===mark?null:mark;
}
export function deleteRegion(jaw,key) { jaw.labels.forEach((id,f)=>{if(id===key)jaw.labels[f]=0;});invalidateControls(jaw); }
export function insidePolygon(x,y,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
// project returns canvas coordinates plus NDC depth. No depth-buffer visibility
// test: every projected face of the current jaw participates, including its back.
export function applyLasso(jaw,key,polygon,subtract,project) {
  if(!key||polygon.length<3)return false;
  let changed=false;
  for(let f=0;f<jaw.labels.length;f++) {
    if(subtract&&jaw.labels[f]!==key)continue;
    const [x,y,z]=project(jaw.centers.subarray(f*3,f*3+3));
    if(z>=-1&&z<=1&&insidePolygon(x,y,polygon)) {
      const next=subtract?0:key;if(next!==jaw.labels[f]){jaw.labels[f]=next;changed=true;}
    }
  }
  if(changed)invalidateControls(jaw);
  return changed;
}
export function boundaryLoops(jaw,key) {
  const adjacency=new Map(), unused=new Set();
  for(const [k,e] of jaw.edges) {
    const own=e.faces.filter(f=>jaw.labels[f]===key).length;
    if(!own || (own===e.faces.length&&e.faces.length>1))continue;
    unused.add(k);
    for(const [a,b] of [[e.a,e.b],[e.b,e.a]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(b);}
  }
  const loops=[];
  while(unused.size) {
    const first=unused.values().next().value, [start,next]=first.split(':').map(Number), path=[start,next];unused.delete(first);
    let current=next;
    while(current!==start) {
      const next=(adjacency.get(current)||[]).find(v=>unused.has(edgeKey(current,v)));
      if(next===undefined)break;
      unused.delete(edgeKey(current,next));path.push(next);current=next;
    }
    if(path.length>2)loops.push({key,vertices:path,closed:current===start});
  }
  return loops;
}
// Sample the whole boundary network together. A selected welded vertex is a
// handle for every loop passing through it, including both sides of a contact.
const controlLayouts=new WeakMap();
function invalidateControls(jaw){controlLayouts.delete(jaw);}
export function prepareBoundaryControls(jaw,loops) {
  if(controlLayouts.has(jaw))return;
  loops??=[...activeRegions(jaw)].flatMap(key=>boundaryLoops(jaw,key));
  const owners=new Map();
  const records=loops.map(loop=>{
    const vertices=loop.closed?loop.vertices.slice(0,-1):loop.vertices.slice(),distances=[0];
    for(let i=1;i<vertices.length;i++)distances.push(distances[i-1]+Math.hypot(...jaw.vertices[vertices[i]].map((x,j)=>x-jaw.vertices[vertices[i-1]][j])));
    const length=(distances.at(-1)||0)+(loop.closed?Math.hypot(...jaw.vertices[vertices[0]].map((x,j)=>x-jaw.vertices[vertices.at(-1)][j])):0);
    const unique=new Set(vertices).size;
    const record={vertices,distances,length,closed:loop.closed,count:0,minimum:Math.min(20,unique),target:Math.min(unique,Math.max(20,Math.min(25,Math.round(length/3)+5))),limit:Math.min(25,unique)};
    for(const v of new Set(vertices)){if(!owners.has(v))owners.set(v,[]);owners.get(v).push(record);}
    return record;
  });
  const selected=new Set();
  while(true){
    let best=-1,bestScore=-1;
    for(const r of records){
      if(r.count>=r.target)continue;
      const chosen=r.vertices.flatMap((v,i)=>selected.has(v)?[r.distances[i]]:[]);
      let next=0;
      for(let i=0;i<r.vertices.length;i++){
        const v=r.vertices[i],d=r.distances[i];
        while(next<chosen.length&&chosen[next]<d)next++;
        if(selected.has(v)||owners.get(v).some(owner=>owner.count>=owner.limit))continue;
        const left=next?chosen[next-1]:r.closed?chosen.at(-1)-r.length:-Infinity;
        const right=next<chosen.length?chosen[next]:r.closed?chosen[0]+r.length:Infinity;
        const score=chosen.length?Math.min(d-left,right-d)/(r.length/r.target||1):Infinity;
        if(score>bestScore||(score===bestScore&&(best<0||v<best))){best=v;bestScore=score;}
      }
    }
    if(best<0)break;
    selected.add(best);for(const owner of owners.get(best))owner.count++;
  }
  // A tiny contact loop may share every candidate with a loop already at its
  // cap. Trade a redundant handle on that neighbor for the missing shared one.
  for(const r of records)while(r.count<r.minimum){
    let repaired=false;
    for(const v of r.vertices){
      if(selected.has(v))continue;
      const removals=new Set(),counts=new Map(records.map(owner=>[owner,owner.count]));
      let possible=true;
      for(const owner of owners.get(v))if(counts.get(owner)>=owner.limit){
        const removable=owner.vertices.find(u=>selected.has(u)&&!removals.has(u)&&!owners.get(u).includes(r)&&owners.get(u).every(other=>counts.get(other)>other.minimum));
        if(removable===undefined){possible=false;break;}
        removals.add(removable);for(const other of owners.get(removable))counts.set(other,counts.get(other)-1);
      }
      if(!possible)continue;
      for(const u of removals){selected.delete(u);for(const owner of owners.get(u))owner.count--;}
      selected.add(v);for(const owner of owners.get(v))owner.count++;
      repaired=true;break;
    }
    if(!repaired)break;
  }
  const regions=new Map();
  for(const loop of loops){if(!regions.has(loop.key))regions.set(loop.key,new Set());for(const v of loop.vertices)if(selected.has(v))regions.get(loop.key).add(v);}
  controlLayouts.set(jaw,{selected,regions});
}
export function controlIndices(jaw,loop) {
  prepareBoundaryControls(jaw);
  const layout=controlLayouts.get(jaw),selected=layout.regions.get(loop.key)??layout.selected,count=loop.vertices.length-(loop.closed?1:0);
  const seen=new Set();
  return loop.vertices.slice(0,count).flatMap((v,i)=>{if(!selected.has(v)||seen.has(v))return [];seen.add(v);return [i];});
}
function snapshotControls(jaw){const layout=controlLayouts.get(jaw);return layout?[...layout.regions].map(([key,vertices])=>[key,[...vertices]]):undefined;}
function restoreControls(jaw,snapshot){
  if(!snapshot){invalidateControls(jaw);return;}
  const regions=new Map(snapshot.map(([key,vertices])=>[key,new Set(vertices)]));
  controlLayouts.set(jaw,{regions,selected:new Set([...regions.values()].flatMap(vertices=>[...vertices]))});
}
function moveControls(jaw,key,vertex,target,separate,before){
  const affected=new Set();jaw.labels.forEach((owner,f)=>{if(owner!==before[f]){affected.add(owner);affected.add(before[f]);}});
  const old=controlLayouts.get(jaw),boundaries=new Map(),groups=new Map(),regions=new Map();
  for(const [owner,controls] of old.regions){
    regions.set(owner,new Set());
    for(const v of controls){if(!groups.has(v))groups.set(v,[]);groups.get(v).push(owner);}
  }
  const nearest=(candidates,p)=>{let best=-1,distance=Infinity;for(const v of candidates){const d=jaw.vertices[v].reduce((sum,x,j)=>sum+(x-p[j])**2,0);if(d<distance||(d===distance&&v<best)){distance=d;best=v;}}return best;};
  for(const [v,owners] of groups){
    if(!owners.some(owner=>affected.has(owner))){for(const owner of owners)regions.get(owner).add(v);continue;}
    for(const owner of owners)if(!boundaries.has(owner))boundaries.set(owner,new Set(boundaryLoops(jaw,owner).flatMap(loop=>loop.vertices)));
    // Keep unchanged anchors exactly where they were. Moving a shared point
    // together uses the intersection of its owners' actual new boundaries.
    const common=[...boundaries.get(owners[0])].filter(candidate=>owners.every(owner=>boundaries.get(owner).has(candidate)));
    const moving=v===vertex;
    const joint=common.length&&!separate?nearest(common,moving?target:jaw.vertices[v]):-1;
    for(const owner of owners){
      const boundary=boundaries.get(owner),p=moving&&(owner===key||!separate)?target:jaw.vertices[v];
      const next=joint>=0?joint:(!moving||separate&&owner!==key)&&boundary.has(v)?v:nearest(boundary,p);
      if(next>=0)regions.get(owner).add(next);
    }
  }
  controlLayouts.set(jaw,{regions,selected:new Set([...regions.values()].flatMap(vertices=>[...vertices]))});
}
// A* on surface edges produces a boundary that remains on the original mesh.
function surfacePath(jaw,start,end,forbidden,guide) {
  if(start===end)return [start];
  const distance=(a,b)=>Math.hypot(...jaw.vertices[a].map((x,j)=>x-jaw.vertices[b][j]));
  const penalties=new Map();
  const penalty=v=>{
    if(!guide)return 1;if(penalties.has(v))return penalties.get(v);
    const p=jaw.vertices[v];let best=Infinity;
    for(let i=1;i<guide.length;i++){
      const a=guide[i-1],b=guide[i],d=b.map((x,j)=>x-a[j]),length=d.reduce((sum,x)=>sum+x*x,0);
      const t=length?Math.max(0,Math.min(1,p.reduce((sum,x,j)=>sum+(x-a[j])*d[j],0)/length)):0;
      best=Math.min(best,p.reduce((sum,x,j)=>sum+(x-a[j]-d[j]*t)**2,0));
    }
    const width=Math.max(.25,distance(start,end)*.15),value=1+6*best/(width*width);penalties.set(v,value);return value;
  };
  const heap=[], costs=new Map([[start,0]]), parents=new Map();
  function push(item){heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;}heap[i]=item;}
  function pop(){const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;}
  push([distance(start,end),start,0]);
  while(heap.length) {
    const [,v,cost]=pop();if(cost!==costs.get(v))continue;
    if(v===end){const path=[v];while(path[0]!==start)path.unshift(parents.get(path[0]));return path;}
    for(const n of jaw.neighbors[v]) {
      if(n!==end&&forbidden.has(n))continue;
      const c=cost+distance(v,n)*(penalty(v)+penalty(n))/2;if(c>=(costs.get(n)??Infinity))continue;
      costs.set(n,c);parents.set(n,v);push([c+distance(n,end),n,c]);
    }
  }
  return null;
}
export function boundaryReplacement(jaw,loop,index,target) {
  if(!loop.closed)return false;
  const count=loop.vertices.length-1, handles=controlIndices(jaw,loop), h=handles.indexOf(index);
  if(h<0||handles.length<3)return false;
  const previous=handles[(h+handles.length-1)%handles.length], next=handles[(h+1)%handles.length];
  const old=loop.vertices.slice(0,-1), remaining=[];
  for(let i=next;;i=(i+1)%count){remaining.push(old[i]);if(i===previous)break;}
  const forbidden=new Set(remaining.slice(1,-1));
  let vertex=-1,best=Infinity;
  jaw.vertices.forEach((p,i)=>{if(forbidden.has(i))return;const d=p.reduce((s,x,j)=>s+(x-target[j])**2,0);if(d<best){best=d;vertex=i;}});
  if(vertex===old[index]||vertex<0)return false;
  // Give edge routing a smooth corridor with a common tangent at the moved
  // point, rather than independently finding two arbitrary mesh-edge shortcuts.
  const before=jaw.vertices[old[handles[(h+handles.length-2)%handles.length]]],after=jaw.vertices[old[handles[(h+2)%handles.length]]];
  const guide=(a,b,c,d)=>Array.from({length:25},(_,i)=>{const t=i/24;return b.map((x,j)=>.5*((2*x)+(-a[j]+c[j])*t+(2*a[j]-5*x+4*c[j]-d[j])*t*t+(-a[j]+3*x-3*c[j]+d[j])*t*t*t));});
  const moved=jaw.vertices[vertex],prev=jaw.vertices[old[previous]],following=jaw.vertices[old[next]];
  const a=surfacePath(jaw,old[previous],vertex,forbidden,guide(before,prev,moved,following));if(!a)return false;
  const b=surfacePath(jaw,vertex,old[next],new Set([...forbidden,...a.slice(0,-1)]),guide(prev,moved,following,after));if(!b)return false;
  const replacement=[...a,...b.slice(1),...remaining.slice(1)];
  if(new Set(replacement.slice(0,-1)).size!==replacement.length-1)return false;
  return replacement;
}
export function moveBoundary(jaw,key,loop,index,target,separate=false) {
  const replacement=boundaryReplacement(jaw,loop,index,target);
  if(!replacement)return false;
  const barriers=new Set();
  for(const current of boundaryLoops(jaw,key)) {
    const path=current.vertices[0]===loop.vertices[0]&&current.vertices[1]===loop.vertices[1]?replacement:current.vertices;
    for(let i=1;i<path.length;i++)barriers.add(edgeKey(path[i-1],path[i]));
  }
  // Keep the interior component with the greatest overlap with the old region.
  // The cut uses all unchanged loops as well, so holes are preserved.
  const visited=new Uint8Array(jaw.labels.length), components=[];let oldSize=0;
  for(const id of jaw.labels)if(id===key)oldSize++;
  for(let start=0;start<jaw.labels.length;start++) {
    if(visited[start])continue;
    const queue=[start];visited[start]=1;let overlap=0;
    for(let q=0;q<queue.length;q++) {
      const f=queue[q];if(jaw.labels[f]===key)overlap++;
      for(const n of jaw.faceNeighbors[f])if(!visited[n.face]&&!barriers.has(n.key)){visited[n.face]=1;queue.push(n.face);}
    }
    if(overlap)components.push({queue,overlap,score:overlap/(queue.length+oldSize-overlap)});
  }
  components.sort((a,b)=>b.score-a.score);if(!components.length)return false;
  const chosen=new Set(components[0].queue);
  // Unchanged disconnected islands stay attached to the same region identity.
  for(const c of components.slice(1))if(c.overlap===c.queue.length)for(const f of c.queue)chosen.add(f);
  const before=jaw.labels.slice(), freed=new Set();
  for(let f=0;f<jaw.labels.length;f++) {
    if(chosen.has(f)) { if(!separate||before[f]===0||before[f]===key)jaw.labels[f]=key; }
    else if(before[f]===key){jaw.labels[f]=0;freed.add(f);}
  }
  // Shared boundaries transfer released faces to their adjacent region. With
  // separation they become gum instead, leaving a lasting gap between curves.
  if(!separate) {
    const queue=[];
    for(const f of freed) {
      const n=jaw.faceNeighbors[f].find(n=>!freed.has(n.face)&&before[n.face]!==key);
      if(n){jaw.labels[f]=before[n.face];queue.push(f);}
    }
    const seen=new Set(queue);
    for(let i=0;i<queue.length;i++)for(const n of jaw.faceNeighbors[queue[i]])if(freed.has(n.face)&&!seen.has(n.face)){seen.add(n.face);jaw.labels[n.face]=jaw.labels[queue[i]];queue.push(n.face);}
  }
  const changed=jaw.labels.some((id,f)=>id!==before[f]);if(changed)moveControls(jaw,key,loop.vertices[index],target,separate,before);return changed;
}
const cloneRegions=regions=>JSON.parse(JSON.stringify(regions));
export class EditSession {
  constructor(jaws){this.jaws=jaws;this.baseline=this.snapshot();this.baselineControls=jaws.map(snapshotControls);this.undoStack=[];this.redoStack=[];this.lastChanges=[];}
  snapshot(){return this.jaws.map(jaw=>({labels:jaw.labels.slice(),regions:cloneRegions(jaw.regions)}));}
  edit(action){
    const before=this.snapshot(),layouts=this.jaws.map(jaw=>controlLayouts.get(jaw)),controls=this.jaws.map(snapshotControls);action();const patches=[];
    this.jaws.forEach((jaw,j)=>{
      const indices=[],old=[],next=[];
      jaw.labels.forEach((id,f)=>{if(id!==before[j].labels[f]){indices.push(f);old.push(before[j].labels[f]);next.push(id);}});
      const regions=cloneRegions(jaw.regions);
      if(indices.length&&controlLayouts.get(jaw)===layouts[j])invalidateControls(jaw);
      if(this.baselineControls[j]===undefined&&controls[j]&&this.undoStack.length===0)this.baselineControls[j]=controls[j];
      if(indices.length||JSON.stringify(regions)!==JSON.stringify(before[j].regions))patches.push({j,indices:new Uint32Array(indices),old:new Uint32Array(old),next:new Uint32Array(next),before:before[j].regions,after:regions,controlsBefore:controls[j],controlsAfter:snapshotControls(jaw)});
    });
    this.lastChanges=patches;
    if(!patches.length)return false;
    this.undoStack.push(patches);this.redoStack=[];return true;
  }
  apply(patches,forward){this.lastChanges=patches;for(const p of patches){const jaw=this.jaws[p.j];p.indices.forEach((f,i)=>{jaw.labels[f]=(forward?p.next:p.old)[i];});jaw.regions=cloneRegions(forward?p.after:p.before);if(p.indices.length)restoreControls(jaw,forward?p.controlsAfter:p.controlsBefore);}}
  undo(){this.lastChanges=[];const p=this.undoStack.pop();if(p){this.apply(p,false);this.redoStack.push(p);}}
  redo(){this.lastChanges=[];const p=this.redoStack.pop();if(p){this.apply(p,true);this.undoStack.push(p);}}
  reset(){this.lastChanges=[];this.jaws.forEach((jaw,j)=>{jaw.labels.set(this.baseline[j].labels);restoreControls(jaw,this.baselineControls[j]);jaw.regions=cloneRegions(this.baseline[j].regions);});this.undoStack=[];this.redoStack=[];}
}
