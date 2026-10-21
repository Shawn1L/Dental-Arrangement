// Render each contact chain once, so adjacent regions use identical smoothed
// coordinates. Controls and topology junctions remain exact fixed endpoints.
export function buildBoundaryCurves(jaw, entries, controls, project) {
  const edges=new Map(),adjacency=new Map(),anchors=new Set(controls);
  const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
  for(const {key,loop} of entries){
    if(!loop.closed){anchors.add(loop.vertices[0]);anchors.add(loop.vertices.at(-1));}
    for(let i=1;i<loop.vertices.length;i++){
      const a=loop.vertices[i-1],b=loop.vertices[i],id=edgeKey(a,b);
      if(!edges.has(id)){edges.set(id,{a,b,keys:new Set()});for(const [v,n] of [[a,b],[b,a]]){if(!adjacency.has(v))adjacency.set(v,new Set());adjacency.get(v).add(n);}}
      edges.get(id).keys.add(key);
    }
  }
  const owners=edge=>[...edge.keys].sort((a,b)=>a-b).join(',');
  for(const [v,neighbors] of adjacency)if(neighbors.size!==2||new Set([...neighbors].map(n=>owners(edges.get(edgeKey(v,n))))).size>1)anchors.add(v);
  const unused=new Set(edges.keys()),curves=[];
  while(unused.size){
    let edge=[...unused].find(id=>{const e=edges.get(id);return anchors.has(e.a)||anchors.has(e.b);})??unused.values().next().value;
    const first=edges.get(edge),start=anchors.has(first.a)?first.a:first.b,path=[start];let v=start;
    while(true){
      unused.delete(edge);const e=edges.get(edge),next=e.a===v?e.b:e.a;path.push(next);v=next;
      if(anchors.has(v)||v===start)break;
      const n=[...adjacency.get(v)].find(n=>unused.has(edgeKey(v,n)));if(n===undefined)break;edge=edgeKey(v,n);
    }
    const raw=path.map(v=>jaw.vertices[v]),distances=[0];
    for(let i=1;i<raw.length;i++)distances.push(distances[i-1]+Math.hypot(...raw[i].map((x,j)=>x-raw[i-1][j])));
    const length=distances.at(-1),count=Math.max(2,Math.min(160,Math.ceil(length/.12)+1));let segment=1;
    let points=Array.from({length:count},(_,i)=>{const d=length*i/(count-1);while(segment<raw.length-1&&distances[segment]<d)segment++;const span=distances[segment]-distances[segment-1],t=span?(d-distances[segment-1])/span:0;return raw[segment-1].map((x,j)=>x+(raw[segment][j]-x)*t);});
    for(let pass=0;pass<6;pass++)points=points.map((p,i)=>i===0||i===points.length-1?p:p.map((x,j)=>(points[i-1][j]+2*x+points[i+1][j])/4));
    points=points.map((p,i)=>i===0?raw[0].slice():i===points.length-1?raw.at(-1).slice():project(p));
    curves.push({keys:[...first.keys],points});
  }
  return curves;
}
