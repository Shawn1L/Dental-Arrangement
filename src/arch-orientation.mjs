// Pure geometry only. Inputs are triangle surfaces, never segmentation labels.
import { Matrix3, Vector3 } from 'three';

const unit = a => new Vector3(...a).normalize().toArray();
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const subtract = (a, b) => a.map((x, i) => x - b[i]);
const scale = (a, k) => a.map(x => x * k);
const add = (a, b) => a.map((x, i) => x + b[i]);

// Jacobi decomposition of a symmetric 3x3 covariance matrix.
function principalAxes(matrix) {
  const a = matrix.map(row => [...row]), v = [[1,0,0],[0,1,0],[0,0,1]];
  for (let step = 0; step < 32; step++) {
    let p = 0, q = 1;
    for (const [i,j] of [[0,2],[1,2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p=i; q=j; }
    if (Math.abs(a[p][q]) < Math.max(...a.map((r,i)=>Math.abs(r[i]))) * 1e-12) break;
    const angle = .5 * Math.atan2(2*a[p][q], a[q][q]-a[p][p]);
    const c=Math.cos(angle), s=Math.sin(angle), pp=a[p][p], qq=a[q][q], pq=a[p][q];
    for (let k=0;k<3;k++) if (k!==p && k!==q) {
      const kp=a[k][p], kq=a[k][q];
      a[k][p]=a[p][k]=c*kp-s*kq; a[k][q]=a[q][k]=s*kp+c*kq;
    }
    a[p][p]=c*c*pp-2*s*c*pq+s*s*qq; a[q][q]=s*s*pp+2*s*c*pq+c*c*qq; a[p][q]=a[q][p]=0;
    for (let k=0;k<3;k++) { const kp=v[k][p],kq=v[k][q]; v[k][p]=c*kp-s*kq; v[k][q]=s*kp+c*kq; }
  }
  return [0,1,2].map(i=>({value:a[i][i],axis:v.map(row=>row[i])})).sort((x,y)=>x.value-y.value);
}

function radicalInverse(n, base) {
  let value=0, factor=1/base;
  while(n) { value+=(n%base)*factor; n=Math.floor(n/base); factor/=base; }
  return value;
}

// Equal-area surface sampling: tessellation density cannot directly bias the fit.
// Barycentric samples also handle a few very large base triangles correctly.
export function sampleSurface(positions, limit=6000) {
  const areas=new Float64Array(positions.length/9), normal=[0,0,0];
  let total=0;
  for(let f=0;f<areas.length;f++) {
    const i=f*9, a=[positions[i+3]-positions[i],positions[i+4]-positions[i+1],positions[i+5]-positions[i+2]];
    const b=[positions[i+6]-positions[i],positions[i+7]-positions[i+1],positions[i+8]-positions[i+2]];
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const area=Math.hypot(...n)/2;
    if(!Number.isFinite(area)) return null;
    areas[f]=area; total+=area;
    for(let k=0;k<3;k++)normal[k]+=n[k]/2;
  }
  if(!(total>0))return null;
  const points=[]; let face=0, cumulative=areas[0];
  for(let j=0;j<limit;j++) {
    const target=(j+.5)*total/limit;
    while(cumulative<target && face<areas.length-1)cumulative+=areas[++face];
    const u=Math.sqrt(radicalInverse(j+1,2)), v=radicalInverse(j+1,3), w=[1-u,u*(1-v),u*v], i=face*9;
    points.push([0,1,2].map(k=>w[0]*positions[i+k]+w[1]*positions[i+3+k]+w[2]*positions[i+6+k]));
  }
  return {points,normal,total};
}

function analyze(surface) {
  const sampled=sampleSurface(surface.positions);
  if(!sampled)return null;
  const {points,normal,total}=sampled;
  const center=points.reduce((s,p)=>add(s,p),[0,0,0]).map(x=>x/points.length);
  const centered=points.map(p=>subtract(p,center));
  const cov=[0,1,2].map(i=>[0,1,2].map(j=>centered.reduce((s,p)=>s+p[i]*p[j],0)/points.length));
  const axes=principalAxes(cov), [height,depth,width]=axes.map(a=>a.value);
  if(!(depth>0 && width/depth>1.12 && height/depth<.45))return null;
  const projected=centered.map(p=>[dot(p,axes[1].axis),dot(p,axes[2].axis)]);
  let best=null;
  // Search in-plane rotation and fit y = a*x² + b*x + c. The sign of a
  // resolves the 180-degree PCA ambiguity; residual measures arch evidence.
  for(let degree=-60;degree<=60;degree++) {
    const angle=degree*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    let x1=0,x2=0,x3=0,x4=0,y1=0,y2=0,xy=0,xxy=0;
    for(const [u,v] of projected) {
      const x=-s*u+c*v,y=c*u+s*v;
      x1+=x;x2+=x*x;x3+=x*x*x;x4+=x*x*x*x;y1+=y;y2+=y*y;xy+=x*y;xxy+=x*x*y;
    }
    const n=points.length;
    if(x2<y2)continue;
    const matrix=new Matrix3().set(n,x1,x2,x1,x2,x3,x2,x3,x4);
    if(Math.abs(matrix.determinant())<1e-12)continue;
    const coefficients=new Vector3(y1,xy,xxy).applyMatrix3(matrix.invert());
    const explained=coefficients.dot(new Vector3(y1,xy,xxy));
    const quality=1-Math.max(0,y2-explained)/Math.max(y2-y1*y1/n,1e-12);
    if(!best || quality>best.quality)best={quality,front:scale(add(scale(axes[1].axis,c),scale(axes[2].axis,s)),-Math.sign(coefficients.z))};
  }
  if(!best || best.quality<.18)return null;
  return {center,up:axes[0].axis,front:best.front,quality:best.quality,normal,total,jaw:surface.jaw,span:Math.sqrt(width)};
}

/** Return a right-handed anatomical frame, or a reason requiring manual setup.
 * Jaw names may resolve up/down; tooth labels and original scanner axes do not.
 */
export function estimateArchFrame(surfaces) {
  const candidates=surfaces.map(analyze).filter(Boolean);
  if(!candidates.length)return {frame:null,reason:'未识别到可靠的完整牙弓，请手动设定正面'};
  const lower=candidates.find(c=>c.jaw==='lower'), upper=candidates.find(c=>c.jaw==='upper');
  const reference=lower || upper || candidates.reduce((a,b)=>a.quality>b.quality?a:b);
  let up=reference.up;
  if(lower && upper) {
    const separation=subtract(upper.center,lower.center);
    if(Math.abs(dot(up,separation))<reference.span*.08)return {frame:null,reason:'上下颌位置不足以确定上下方向，请手动设定正面'};
    up=scale(up,Math.sign(dot(up,separation)));
    const other=scale(upper.up,Math.sign(dot(upper.up,up)));
    if(dot(other,up)<.85)return {frame:null,reason:'上下颌方向不一致，请手动设定正面'};
    up=unit(add(up,other));
  } else {
    if(!['upper','lower'].includes(reference.jaw) || Math.abs(dot(up,reference.normal))/reference.total<.025)
      return {frame:null,reason:'单颌上下方向不明确，请选择颌面并手动设定正面'};
    up=scale(up,Math.sign(dot(up,reference.normal))*(reference.jaw==='upper'?-1:1));
  }
  let front=reference.front;
  if(lower && upper) {
    if(dot(lower.front,upper.front)<.7)return {frame:null,reason:'上下颌前方判断不一致，请手动设定正面'};
    front=unit(add(lower.front,upper.front));
  }
  front=unit(subtract(front,scale(up,dot(front,up))));
  const right=new Vector3(...front).cross(new Vector3(...up)).normalize().toArray();
  return {frame:{front,up,right},reason:'已按牙弓几何自动定向（可手动校正）'};
}
