import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { inferJaw, validateSTL } from './stl.mjs';
import './style.css';

const svg = (body: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const arch = '<path d="M7 26V14a9 9 0 0 1 18 0v12h-4V14a5 5 0 0 0-10 0v12z"/>';
const bite = '<path d="M5 11c6 1 16 1 22-2v5c-7 2-16 2-22 1zM5 21c6-1 16-1 22 1v4c-7-1-16-1-22 0z"/>';
const views = [ ['upper','上颌面',arch], ['front','正面',bite], ['right','右侧',bite], ['oblique','仰视',bite], ['left','左侧',bite], ['back','后视',bite], ['lower','下颌面','<g transform="rotate(180 16 16)">'+arch+'</g>'] ];
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="viewport" aria-label="STL 三维查看器"></main>
  <header class="brand"><span class="brand-mark">${svg(arch)}</span><div><strong>STL <span>STUDIO</span></strong><small>牙模可视化工作台</small></div></header>
  <nav class="views" aria-label="标准视角">${views.map(([id,label,icon]) => `<button class="view ${id==='front'?'active':''}" data-view="${id}" aria-pressed="${id==='front'}" title="${label}">${svg(icon)}<span>${label}</span></button>`).join('')}<span class="divider"></span><label class="jaw-select">${svg(bite)}<select id="filter" aria-label="显示颌面"><option value="all">全颌</option><option value="upper">上颌</option><option value="lower">下颌</option></select></label></nav>
  <div class="top-actions"><button id="panel-toggle" class="icon-button" title="显示或隐藏模型面板" aria-label="显示或隐藏模型面板">${svg('<path d="M6 7h20v18H6zM19 7v18"/>')}</button><button id="import" class="primary" aria-label="导入 STL">${svg('<path d="M16 21V5m-5 5 5-5 5 5M6 20v7h20v-7"/>')}<span>导入 STL</span></button></div>
  <aside id="panel" hidden><div class="panel-title"><span>模型图层</span><span id="model-count">0 个模型</span></div><div id="models"></div><button id="add-model" class="add-model">＋ 添加模型</button><div class="settings"><label>表面显示<select id="surface"><option value="smooth">平滑</option><option value="flat">原始面片</option><option value="wire">线框</option></select></label><label>透明度 <output id="opacity-value">100%</output><input id="opacity" type="range" min="10" max="100" value="100" aria-label="模型透明度"/></label><label>模型朝向<select id="orientation"><option value="z">Z 轴向上（牙模）</option><option value="y">Y 轴向上</option></select></label><div class="rotate-actions"><button data-rotate="x">X 轴 +90°</button><button data-rotate="y">Y 轴 +90°</button><button data-rotate="z">Z 轴 +90°</button></div></div><p class="privacy">${svg('<rect x="8" y="14" width="16" height="13" rx="3"/><path d="M11 14V9a5 5 0 0 1 10 0v5"/>')} 文件在本地处理</p></aside>
  <section id="empty" hidden><span class="empty-icon">${svg(arch)}</span><h1>把模型放到这里</h1><p>拖入 STL 文件，开始查看你的三维模型</p><button id="empty-import" class="primary">选择 STL 文件</button><button id="demo" class="text-button">加载上下颌示例</button></section>
  <div id="drop-overlay" hidden>释放文件，导入 STL 模型</div>
  <footer><div class="status"><span class="status-dot"></span><span id="status" role="status">准备加载示例</span></div><div class="gestures">左键旋转<span>·</span>右键平移<span>·</span>滚轮缩放</div><span id="dimensions">STL 坐标单位</span></footer>
  <div class="bottom-tools"><button id="fit" class="icon-button" title="适应窗口（F）" aria-label="适应窗口">${svg('<path d="M12 6H6v6m14-6h6v6M6 20v6h6m14-6v6h-6"/>')}</button><button id="reset" class="icon-button" title="恢复初始视图" aria-label="恢复初始视图">${svg('<path d="M7 13a10 10 0 1 1 1 12M7 5v8h8"/>')}</button><span class="divider"></span><button id="screenshot" class="icon-button" title="导出 PNG 截图" aria-label="导出 PNG 截图">${svg('<path d="M4 10h7l2-4h6l2 4h7v16H4z"/><circle cx="16" cy="18" r="5"/>')}</button></div>
  <div id="toast" role="alert" hidden></div><input id="file-input" type="file" accept=".stl" multiple hidden/>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = $('viewport');
let renderer: THREE.WebGLRenderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
catch { $('status').textContent = 'WebGL 不可用'; $('empty').hidden = false; $('empty').innerHTML = '<h1>无法启动三维视图</h1><p>请使用支持 WebGL 的浏览器，并开启硬件加速。</p>'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xf4f4f4); renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x968774, 2.2));
for (const [x,y,z,power] of [[-60,80,100,2.5],[70,20,40,1.3],[0,0,-100,1]]) { const light = new THREE.DirectionalLight(0xffffff,power); light.position.set(x,y,z); scene.add(light); }
const camera = new THREE.OrthographicCamera(-60,60,40,-40,0.01,10000);
camera.position.set(0,0,200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.minZoom = 0.08; controls.maxZoom = 25;
controls.rotateSpeed = 0.65; controls.zoomSpeed = 0.85; controls.screenSpacePanning = true;
controls.minPolarAngle = 0.005; controls.maxPolarAngle = Math.PI - 0.005;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const group = new THREE.Group(); group.rotation.x = -Math.PI/2; scene.add(group);
const loader = new STLLoader();
type Model = { id: number; name: string; jaw: 'upper'|'lower'|'other'; enabled: boolean; mesh: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>; triangles: number };
const models: Model[] = []; let nextId = 0; let activeView = 'front'; let radius = 60; let toastTimer = 0; let loading = 0;
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(()=> $('toast').hidden = true,5000); }
function resize() { const w=viewport.clientWidth,h=viewport.clientHeight; renderer.setSize(w,h); camera.left=-radius*w/h; camera.right=radius*w/h; camera.top=radius; camera.bottom=-radius; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(viewport);
function visibleBounds() { group.updateMatrixWorld(true); const bounds=new THREE.Box3(); for(const model of models) if(model.mesh.visible) bounds.union(new THREE.Box3().setFromObject(model.mesh)); return bounds; }
function fit() {
  const bounds=visibleBounds(); if(bounds.isEmpty()) return;
  const center=bounds.getCenter(new THREE.Vector3()); const size=bounds.getSize(new THREE.Vector3());
  camera.updateMatrixWorld(); const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0); const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
  const projectedWidth=Math.abs(right.x)*size.x+Math.abs(right.y)*size.y+Math.abs(right.z)*size.z;
  const projectedHeight=Math.abs(up.x)*size.x+Math.abs(up.y)*size.y+Math.abs(up.z)*size.z;
  const aspect=viewport.clientWidth/viewport.clientHeight;
  radius=Math.max(projectedHeight/2,projectedWidth/2/aspect,0.001)*1.45;
  const direction=camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(center); camera.position.copy(center).addScaledVector(direction,radius*4); camera.near=Math.max(radius/10000,0.00001); camera.far=radius*100; camera.zoom=1; resize(); controls.update();
  $('dimensions').textContent = size.toArray().map(v=>v.toFixed(1)).join(' × ')+' · STL 单位';
}
const directions: Record<string,number[]> = { front:[0,0,1],right:[1,0,0],left:[-1,0,0],back:[0,0,-1],upper:[0,-1,0.001],lower:[0,1,0.001],oblique:[0,-0.55,1] };
function setView(id: string) { activeView=id; const d=directions[id]; controls.enableDamping=false;controls.update();camera.up.set(0,1,0);camera.position.copy(controls.target).add(new THREE.Vector3(...d).normalize().multiplyScalar(radius*4)); controls.update();controls.enableDamping=true; document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{const active=b.dataset.view===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}); fit(); }
controls.addEventListener('start',()=>document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');}));
function applyVisibility() { const filter=$<HTMLSelectElement>('filter').value; for(const model of models) model.mesh.visible=model.enabled&&(filter==='all'||model.jaw===filter); const visible=models.filter(m=>m.mesh.visible); $('status').textContent = loading ? '正在读取模型…' : visible.length ? `${visible.length} 个模型 · ${visible.reduce((s,m)=>s+m.triangles,0).toLocaleString()} 个三角面` : models.length ? '当前筛选下没有可见模型' : '等待导入 STL'; $('empty').hidden=!!models.length || !!loading; }
function renderList() {
  $('model-count').textContent=`${models.length} 个模型`; $('models').replaceChildren();
  for(const model of models) {
    const row=document.createElement('div'); row.className='model-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=model.enabled;check.setAttribute('aria-label',`显示 ${model.name}`);check.onchange=()=>{model.enabled=check.checked;applyVisibility();fit();};
    const info=document.createElement('div');info.className='model-info';const name=document.createElement('strong');name.textContent=model.name;name.title=model.name;const detail=document.createElement('small');detail.textContent=`${model.triangles.toLocaleString()} 个三角面`;info.append(name,detail);
    const jaw=document.createElement('select');jaw.setAttribute('aria-label',`${model.name} 所属颌面`);for(const [value,label] of [['upper','上颌'],['lower','下颌'],['other','其他']])jaw.add(new Option(label,value));jaw.value=model.jaw;jaw.onchange=()=>{model.jaw=jaw.value as Model['jaw'];applyVisibility();fit();};
    const remove=document.createElement('button');remove.className='remove';remove.textContent='×';remove.title=`移除 ${model.name}`;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{group.remove(model.mesh);model.mesh.geometry.dispose();model.mesh.material.dispose();models.splice(models.indexOf(model),1);renderList();fit();};
    row.append(check,info,jaw,remove);$('models').append(row);
  } applyVisibility();
}
function addBuffer(buffer: ArrayBuffer, name: string) {
  validateSTL(buffer); let geometry=loader.parse(buffer); const position=geometry.getAttribute('position');
  if(!position || position.count<3 || position.count%3) {geometry.dispose();throw new Error('没有有效的三角面。');}
  for(let i=0;i<position.array.length;i++) if(!Number.isFinite(position.array[i])) {geometry.dispose();throw new Error('模型包含无效坐标。');}
  const triangles=position.count/3;
  geometry.deleteAttribute('normal');geometry.deleteAttribute('color');const original=geometry;geometry=mergeVertices(geometry,0.00001);original.dispose();geometry.computeVertexNormals();geometry.computeBoundingBox();
  const opacity=Number($<HTMLInputElement>('opacity').value)/100;const surface=$<HTMLSelectElement>('surface').value;
  const material=new THREE.MeshStandardMaterial({color:0xc7a775,roughness:0.65,metalness:0,side:THREE.DoubleSide,opacity,transparent:opacity<1,depthWrite:opacity===1,flatShading:surface==='flat',wireframe:surface==='wire'});
  const mesh=new THREE.Mesh(geometry,material);group.add(mesh);models.push({id:nextId++,name,jaw:inferJaw(name),enabled:true,mesh,triangles});
}
async function importFiles(files: File[]) { loading++;applyVisibility();for(const file of files) { if(!/\.stl$/i.test(file.name)){toast(`${file.name}：仅支持 STL 文件`);continue;}if(file.size>150*1024*1024){toast(`${file.name}：文件超过 150 MB`);continue;}try{addBuffer(await file.arrayBuffer(),file.name);}catch(e){toast(`${file.name}：${(e as Error).message}`);} } loading--;renderList();fit(); }
const input=$<HTMLInputElement>('file-input');input.onchange=()=>{void importFiles(Array.from(input.files||[]));input.value='';};
for(const id of ['import','add-model','empty-import']) $(id).onclick=()=>input.click();
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view!));
$('filter').onchange=()=>{applyVisibility();fit();};
$('panel-toggle').onclick=()=>{$('panel').hidden=!$('panel').hidden;};
$('fit').onclick=fit;$('reset').onclick=()=>{group.rotation.set($<HTMLSelectElement>('orientation').value==='z'?-Math.PI/2:0,0,0);setView('front');};
$('orientation').onchange=()=>{group.rotation.set($<HTMLSelectElement>('orientation').value==='z'?-Math.PI/2:0,0,0);setView(activeView);};
document.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach(b=>b.onclick=()=>{group.rotateOnWorldAxis(new THREE.Vector3(b.dataset.rotate==='x'?1:0,b.dataset.rotate==='y'?1:0,b.dataset.rotate==='z'?1:0),Math.PI/2);fit();});
$('surface').onchange=()=>{for(const m of models){m.mesh.material.flatShading=$<HTMLSelectElement>('surface').value==='flat';m.mesh.material.wireframe=$<HTMLSelectElement>('surface').value==='wire';m.mesh.material.needsUpdate=true;}};
$('opacity').oninput=()=>{const value=Number($<HTMLInputElement>('opacity').value);$('opacity-value').textContent=value+'%';for(const m of models){m.mesh.material.opacity=value/100;m.mesh.material.transparent=value<100;m.mesh.material.depthWrite=value===100;}};
$('screenshot').onclick=()=>{renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{if(!blob){toast('截图失败');return;}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`STL-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
let dragDepth=0;window.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;void importFiles(Array.from(e.dataTransfer?.files||[]));});
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)return;if(e.key.toLowerCase()==='f')fit();});
async function loadDemo() { if(loading)return;loading++;applyVisibility();let added=0;for(const [file,name] of [['upper.stl','示例 · 上颌模型.stl'],['lower.stl','示例 · 下颌模型.stl']]){if(models.some(m=>m.name===name))continue;try{const response=await fetch(`${import.meta.env.BASE_URL}demo/${file}`);if(!response.ok)throw new Error('示例文件不可用');addBuffer(await response.arrayBuffer(),name);added++;}catch(e){toast((e as Error).message);}}loading--;renderList();if(added)setView('front'); }
$('demo').onclick=()=>void loadDemo();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});resize();void loadDemo();
