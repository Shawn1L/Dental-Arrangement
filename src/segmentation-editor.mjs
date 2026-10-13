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
export function deleteRegion(jaw,key) { jaw.labels.forEach((id,f)=>{if(id===key)jaw.labels[f]=0;}); }
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
    if(path.length>2)loops.push({vertices:path,closed:current===start});
  }
  return loops;
}
export function controlIndices(jaw,loop,spacing=1) {
  const path=loop.vertices, result=[0];let distance=0;
  for(let i=1;i<path.length-1;i++) {
    distance+=Math.hypot(...jaw.vertices[path[i]].map((x,j)=>x-jaw.vertices[path[i-1]][j]));
    if(distance>=spacing){result.push(i);distance=0;}
  }
  // Even tiny regions need three distinct editing handles.
  if(result.length<3&&path.length>=4)return [...new Set([0,Math.floor((path.length-1)/3),Math.floor((path.length-1)*2/3)])];
  return result;
}
// A* on surface edges produces a boundary that remains on the original mesh.
function surfacePath(jaw,start,end,forbidden) {
  if(start===end)return [start];
  const distance=(a,b)=>Math.hypot(...jaw.vertices[a].map((x,j)=>x-jaw.vertices[b][j]));
  const heap=[], costs=new Map([[start,0]]), parents=new Map();
  function push(item){heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;}heap[i]=item;}
  function pop(){const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;}
  push([distance(start,end),start,0]);
  while(heap.length) {
    const [,v,cost]=pop();if(cost!==costs.get(v))continue;
    if(v===end){const path=[v];while(path[0]!==start)path.unshift(parents.get(path[0]));return path;}
    for(const n of jaw.neighbors[v]) {
      if(n!==end&&forbidden.has(n))continue;
      const c=cost+distance(v,n);if(c>=(costs.get(n)??Infinity))continue;
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
  const a=surfacePath(jaw,old[previous],vertex,forbidden);if(!a)return false;
  const b=surfacePath(jaw,vertex,old[next],new Set([...forbidden,...a.slice(0,-1)]));if(!b)return false;
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
  return jaw.labels.some((id,f)=>id!==before[f]);
}
const cloneRegions=regions=>JSON.parse(JSON.stringify(regions));
export class EditSession {
  constructor(jaws){this.jaws=jaws;this.baseline=this.snapshot();this.undoStack=[];this.redoStack=[];this.lastChanges=[];}
  snapshot(){return this.jaws.map(jaw=>({labels:jaw.labels.slice(),regions:cloneRegions(jaw.regions)}));}
  edit(action){
    const before=this.snapshot();action();const patches=[];
    this.jaws.forEach((jaw,j)=>{
      const indices=[],old=[],next=[];
      jaw.labels.forEach((id,f)=>{if(id!==before[j].labels[f]){indices.push(f);old.push(before[j].labels[f]);next.push(id);}});
      const regions=cloneRegions(jaw.regions);
      if(indices.length||JSON.stringify(regions)!==JSON.stringify(before[j].regions))patches.push({j,indices:new Uint32Array(indices),old:new Uint32Array(old),next:new Uint32Array(next),before:before[j].regions,after:regions});
    });
    this.lastChanges=patches;
    if(!patches.length)return false;
    this.undoStack.push(patches);this.redoStack=[];return true;
  }
  apply(patches,forward){this.lastChanges=patches;for(const p of patches){const jaw=this.jaws[p.j];p.indices.forEach((f,i)=>{jaw.labels[f]=(forward?p.next:p.old)[i];});jaw.regions=cloneRegions(forward?p.after:p.before);}}
  undo(){this.lastChanges=[];const p=this.undoStack.pop();if(p){this.apply(p,false);this.redoStack.push(p);}}
  redo(){this.lastChanges=[];const p=this.redoStack.pop();if(p){this.apply(p,true);this.undoStack.push(p);}}
  reset(){this.lastChanges=[];this.jaws.forEach((jaw,j)=>{jaw.labels.set(this.baseline[j].labels);jaw.regions=cloneRegions(this.baseline[j].regions);});this.undoStack=[];this.redoStack=[];}
}
