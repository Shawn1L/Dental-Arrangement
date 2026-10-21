import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { inferJaw } from './stl.mjs';
import { estimateArchFrame } from './arch-orientation.mjs';
import { parseModelGeometry } from './model-loader.mjs';
import { clearModels, createModelImporter } from './model-import.mjs';
import { discoverCases, type LocalCase } from './folder-import.mjs';
import { createPreloadedCases, loadPreloadedRefinement } from './preloaded.mjs';
import preloadedCatalog from './preloaded-cases.json';
import { createReferenceGrid } from './reference-grid';
import { createToothLabels } from './tooth-labels';
import { createAdjustment } from './adjustment';
import type { EditableJaw } from './segmentation-editor.mjs';
import { createToothAnnotations, type ToothAnnotation } from './segmentation.mjs';
import { objTopology, expandedGeometry, packRefinement, refineSegmentation } from './segmentation-refinement.mjs';
import './style.css';

const svg = (body: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const arch = '<path d="M7 26V14a9 9 0 0 1 18 0v12h-4V14a5 5 0 0 0-10 0v12z"/>';
const bite = '<path d="M5 11c6 1 16 1 22-2v5c-7 2-16 2-22 1zM5 21c6-1 16-1 22 1v4c-7-1-16-1-22 0z"/>';
const views = [ ['upper','上颌面',arch], ['front','正面',bite], ['right','右侧',bite], ['oblique','仰视',bite], ['left','左侧',bite], ['back','后视',bite], ['lower','下颌面','<g transform="rotate(180 16 16)">'+arch+'</g>'] ];
const steps = ['模型预处理', '分牙', '初始位模型', '治疗计划', '目标位', '分步', '附件'];
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="workflow-header"><div class="workflow-brand">${svg(arch)}<span>STL <b>STUDIO</b></span></div><nav class="steps" aria-label="工作流程步骤">${steps.map((name,index)=>`<button class="step ${index===0?'active':''}" data-step="${name}" aria-pressed="${index===0}"><span class="step-number">${index+1}</span><span>${name}</span></button>${index<steps.length-1?'<span class="step-arrow" aria-hidden="true">›</span>':''}`).join('')}</nav></header>
  <nav class="feature-bar" aria-label="预处理功能"><button data-feature="网格" aria-pressed="false" title="开启网格并切换正交投影">${svg('<rect x="6" y="6" width="20" height="20" rx="1"/><path d="M6 13h20M6 20h20M13 6v20M20 6v20"/>')}<span>网格</span></button><button data-feature="咬合碰撞">${svg(bite)}<span>咬合碰撞</span></button></nav>
  <section id="workspace" aria-label="模型预处理">
  <main id="viewport" aria-label="牙模三维查看器"></main>
  <div id="segmentation-hints" hidden><ul><li>模拟方案，实际治疗效果可能不同</li><li>左键旋转视角，中键拖动或滚轮缩放，右键拖动平移牙模</li></ul></div>
  <div id="model-adjustment-actions"><button id="adjust-model" class="primary">调整模型</button></div>
  <div id="segmentation-actions" hidden><button id="adjust-segmentation" class="primary">调整分牙</button></div>
  <div id="segmentation-state" role="status" hidden></div>
  <nav class="views" aria-label="标准视角">${views.map(([id,label,icon]) => `<button class="view ${id==='front'?'active':''}" data-view="${id}" aria-pressed="${id==='front'}" title="${label}">${svg(icon)}<span>${label}</span></button>`).join('')}<span class="divider"></span><label class="jaw-select">${svg(bite)}<select id="filter" aria-label="显示颌面"><option value="all">全颌</option><option value="upper">上颌</option><option value="lower">下颌</option></select></label></nav>
  <div id="case-picker" hidden><label>病例 <select id="case-select" aria-label="选择病例"></select></label></div><div class="top-actions"><button id="preloaded-import" class="preloaded-button">预载数据</button><button id="panel-toggle" class="icon-button" title="显示或隐藏模型面板" aria-label="显示或隐藏模型面板">${svg('<path d="M6 7h20v18H6zM19 7v18"/>')}</button><button id="import" class="primary" aria-label="选择数据文件夹">${svg('<path d="M16 21V5m-5 5 5-5 5 5M6 20v7h20v-7"/>')}<span>选择数据文件夹</span></button></div>
  <aside id="panel" hidden><div class="panel-title"><span>模型图层</span><span id="model-count">0 个模型</span></div><div id="models"></div><button id="add-model" class="add-model">＋ 选择数据文件夹</button><div class="settings"><label>表面显示<select id="surface"><option value="smooth">平滑</option><option value="flat">原始面片</option><option value="wire">线框</option></select></label><label>透明度 <output id="opacity-value">100%</output><input id="opacity" type="range" min="10" max="100" value="100" aria-label="模型透明度"/></label><label>模型朝向<select id="orientation"><option value="auto">牙弓自动定向</option><option value="z">Z 轴向上（牙模）</option><option value="y">Y 轴向上</option></select></label><div class="rotate-actions"><button data-rotate="x">X 轴 +90°</button><button data-rotate="y">Y 轴 +90°</button><button data-rotate="z">Z 轴 +90°</button></div><p id="orientation-status" class="orientation-status" role="status">加载模型后自动识别牙弓方向</p><div class="orientation-actions"><button id="auto-orient">重新自动定向</button><button id="calibrate-front">将当前视角设为正面</button></div></div><p class="privacy">${svg('<rect x="8" y="14" width="16" height="13" rx="3"/><path d="M11 14V9a5 5 0 0 1 10 0v5"/>')} 读取文件夹中的已有分牙结果</p></aside>
  <section id="empty"><span class="empty-icon">${svg(arch)}</span><h1>加载牙模数据</h1><p>选择包含上下颌模型和分牙 JSON 的整个文件夹<br/>自动读取已有分牙结果，支持多个病例切换</p><button id="empty-preloaded" class="primary">加载预载数据 · 12 组案例</button><button id="empty-import" class="add-model">选择数据文件夹</button><button id="single-import" class="add-model">单独上传 STL / OBJ</button><small>支持 OBJ / STL + 同名 JSON · 单模型最大 150 MB</small></section>
  <footer><div class="status"><span class="status-dot"></span><span id="status" role="status">等待选择数据文件夹</span></div><div class="gestures">左键旋转<span>·</span>右键平移<span>·</span>中键 / 滚轮缩放</div><span class="view-info"><span id="projection-label">透视投影</span><span id="dimensions">模型坐标单位</span></span></footer>
  <div class="bottom-tools"><button id="fit" class="icon-button" title="适应窗口（F）" aria-label="适应窗口">${svg('<path d="M12 6H6v6m14-6h6v6M6 20v6h6m14-6v6h-6"/>')}</button><button id="reset" class="icon-button" title="恢复初始视图" aria-label="恢复初始视图">${svg('<path d="M7 13a10 10 0 1 1 1 12M7 5v8h8"/>')}</button><span class="divider"></span><button id="screenshot" class="icon-button" title="导出 PNG 截图" aria-label="导出 PNG 截图">${svg('<path d="M4 10h7l2-4h6l2 4h7v16H4z"/><circle cx="16" cy="18" r="5"/>')}</button></div>
  </section>
  <section id="development" hidden aria-label="开发中"><div class="development-content"><span class="development-icon">${svg('<path d="M8 11 3 16l5 5m16-10 5 5-5 5M19 7l-6 18"/>')}</span><span class="development-badge">开发中</span><h1 id="development-title"></h1><p>该功能还在开发中</p><button id="back-preprocessing" class="primary">返回模型预处理</button></div></section>
  <div id="drop-overlay" hidden>释放文件，导入牙模</div><div id="toast" role="alert" hidden></div><input id="folder-input" type="file" webkitdirectory multiple hidden/><input id="file-input" type="file" accept=".stl,.obj" multiple hidden/>`;

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
const perspectiveCamera = new THREE.PerspectiveCamera(35,1,0.01,10000);
const orthographicCamera = new THREE.OrthographicCamera(-60,60,40,-40,0.01,10000);
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera;
let gridEnabled = false;
const referenceGrid = createReferenceGrid();
camera.position.set(0,0,200);
const controls = new OrbitControls(camera, renderer.domElement);
let segmentationActive = false;
let showToothNumbers = false;
let adjustment:ReturnType<typeof createAdjustment>|undefined;
const featureBar = document.querySelector<HTMLElement>('.feature-bar')!;
const preprocessingFeatures = featureBar.innerHTML;
const toothIcon = '<path d="M9 5c3-2 4 1 7 1s4-3 7-1c5 4 1 10 0 14s-2 9-4 8-1-8-3-8-1 8-3 8-3-6-4-9S5 8 9 5z"/><circle cx="25" cy="23" r="5"/><path d="m23 23 1 1 3-3"/>';
function selectStep(name: string, feature?: string) {
  if(adjustment?.active){adjustment.guard(()=>selectStep(name,feature));return;}
  if(name===steps[1]&&!segmentationReady())return;
  const preprocessing = name === steps[0] && !feature;
  segmentationActive = name === steps[1];
  const viewer = preprocessing || segmentationActive;
  document.body.classList.toggle('segmentation-stage', segmentationActive);
  featureBar.setAttribute('aria-label',segmentationActive?'分牙功能':'预处理功能');
  featureBar.innerHTML = segmentationActive ? `<button id="tooth-number-toggle" aria-pressed="${showToothNumbers}" class="${showToothNumbers?'active':''}">${svg(toothIcon)}<span>牙号</span></button>` : preprocessingFeatures;
  if (segmentationActive) $('tooth-number-toggle').onclick=()=>{showToothNumbers=!showToothNumbers;$('tooth-number-toggle').classList.toggle('active',showToothNumbers);$('tooth-number-toggle').setAttribute('aria-pressed',String(showToothNumbers));};
  else bindFeatures();
  $('workspace').hidden = !viewer;
  $('development').hidden = viewer;
  $('workspace').setAttribute('aria-label',segmentationActive ? '分牙' : '模型预处理');
  $('segmentation-hints').hidden = !segmentationActive;
  $('segmentation-actions').hidden = !segmentationActive;
  $('model-adjustment-actions').hidden = !preprocessing;
  if(segmentationActive)$('panel').hidden=true;
  for(const model of models){model.mesh.geometry=segmentationActive && model.refined ? model.refined : model.source;model.mesh.material.vertexColors=segmentationActive && !!model.teeth;model.mesh.material.color.set(model.mesh.material.vertexColors?0xffffff:0xc7a775);model.mesh.material.needsUpdate=true;}
  updateSegmentationState();
  $('development-title').textContent = feature || name;
  controls.enabled = viewer;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  if(viewer){resize();if(pendingFit)fit();}
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button=>{
    const selected=button.dataset.step===name;
    button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-feature]').forEach(button=>{
    const selected=button.dataset.feature==='网格' ? gridEnabled : button.dataset.feature===feature;
    button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button=>button.onclick=()=>selectStep(button.dataset.step!));
function bindFeatures(){document.querySelectorAll<HTMLButtonElement>('[data-feature]').forEach(button=>button.onclick=()=>{
  if(button.dataset.feature==='网格'){selectStep(steps[0]);toggleGrid();}
  else selectStep(steps[0],button.dataset.feature);
});}bindFeatures();
$('back-preprocessing').onclick=()=>selectStep(steps[0]);
$('adjust-model').onclick=()=>selectStep(steps[0],'模型调整');
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.minZoom = 0.08; controls.maxZoom = 25;
controls.rotateSpeed = 0.65; controls.zoomSpeed = 0.85; controls.screenSpacePanning = true;
controls.minPolarAngle = 0.005; controls.maxPolarAngle = Math.PI - 0.005;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const group = new THREE.Group(); group.rotation.x = -Math.PI/2; scene.add(group);
const initialOrientation = group.quaternion.clone();
const calibratedCases = new WeakMap<LocalCase,THREE.Quaternion>();
type Model = { id: number; name: string; jaw: 'upper'|'lower'|'other'; enabled: boolean; mesh: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>; triangles: number; source: THREE.BufferGeometry; refined?: THREE.BufferGeometry; topology?: ReturnType<typeof objTopology>; pendingResult?: unknown; refinementUrl?: string; teeth?: ToothAnnotation[];faceLabels?:Uint16Array;editable?:EditableJaw };
const models: Model[] = []; let nextId = 0; let activeView = 'front'; let radius = 60; let toastTimer = 0; let loading = 0; let pendingFit = false;
let localResults=false;let localCases:LocalCase[]=[];let importErrors:string[]=[];
let segmentationGeneration=0;let segmentationRunning=false;let segmentationAbort:AbortController|undefined;let segmentationMessage='';
function clearToast(){ $('toast').hidden=true;clearTimeout(toastTimer); }
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(()=> $('toast').hidden = true,5000); }
function invalidateSegmentation(model:Model){segmentationGeneration++;segmentationAbort?.abort();segmentationRunning=false;segmentationMessage='';model.teeth=undefined;model.faceLabels=undefined;model.editable=undefined;model.pendingResult=undefined;model.mesh.geometry=model.source;model.refined?.dispose();model.refined=undefined;updateSegmentationState();}
function resize() { const w=viewport.clientWidth,h=viewport.clientHeight; if(!w || !h)return;renderer.setSize(w,h); perspectiveCamera.aspect=w/h; perspectiveCamera.updateProjectionMatrix(); orthographicCamera.left=-radius*w/h; orthographicCamera.right=radius*w/h; orthographicCamera.top=radius; orthographicCamera.bottom=-radius; orthographicCamera.updateProjectionMatrix(); }
function toggleGrid() {
  // Flush damping before changing cameras so toggling cannot add a rotation.
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
  const previous=camera;
  const direction=previous.position.clone().sub(controls.target).normalize();
  const halfHeight=previous instanceof THREE.PerspectiveCamera
    ? previous.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(previous.fov/2))/previous.zoom
    : (previous.top-previous.bottom)/2/previous.zoom;
  gridEnabled=!gridEnabled;
  camera=gridEnabled ? orthographicCamera : perspectiveCamera;
  camera.position.copy(previous.position);camera.quaternion.copy(previous.quaternion);camera.up.copy(previous.up);
  camera.near=previous.near;camera.far=previous.far;camera.zoom=1;
  radius=halfHeight;
  if(camera instanceof THREE.PerspectiveCamera){
    const distance=halfHeight/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    camera.position.copy(controls.target).addScaledVector(direction,distance);
    camera.far=Math.max(camera.far,distance+radius*100);
  }
  controls.object=camera;resize();controls.update();controls.enableDamping=damping;
  const button=document.querySelector<HTMLButtonElement>('[data-feature="网格"]')!;
  button.classList.toggle('active',gridEnabled);button.setAttribute('aria-pressed',String(gridEnabled));
  $('projection-label').textContent=gridEnabled ? '正交投影 · 小格 1 / 大格 10 模型单位' : '透视投影';
}
new ResizeObserver(resize).observe(viewport);
function visibleBounds() { group.updateMatrixWorld(true); const bounds=new THREE.Box3(); for(const model of models) if(model.mesh.visible) bounds.union(new THREE.Box3().setFromObject(model.mesh)); return bounds; }
function fit() {
  if(!viewport.clientWidth || !viewport.clientHeight){pendingFit=true;return;}
  pendingFit=false;
  const bounds=visibleBounds(); if(bounds.isEmpty()) return;
  const center=bounds.getCenter(new THREE.Vector3()); const size=bounds.getSize(new THREE.Vector3());
  camera.updateMatrixWorld(); const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0); const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
  const projectedWidth=Math.abs(right.x)*size.x+Math.abs(right.y)*size.y+Math.abs(right.z)*size.z;
  const projectedHeight=Math.abs(up.x)*size.x+Math.abs(up.y)*size.y+Math.abs(up.z)*size.z;
  const aspect=viewport.clientWidth/viewport.clientHeight;
  radius=Math.max(projectedHeight/2,projectedWidth/2/aspect,0.001)*1.45;
  const direction=camera.position.clone().sub(controls.target).normalize();
  const forward=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2);
  const projectedDepth=Math.abs(forward.x)*size.x+Math.abs(forward.y)*size.y+Math.abs(forward.z)*size.z;
  const distance=camera instanceof THREE.PerspectiveCamera
    ? radius/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))+projectedDepth/2
    : Math.max(size.length()*2,radius*4);
  controls.target.copy(center); camera.position.copy(center).addScaledVector(direction,distance); camera.near=Math.max(distance/100000,0.00001); camera.far=Math.max(size.length()*10,radius*100); camera.zoom=1; resize(); controls.update();
  $('dimensions').textContent = size.toArray().map(v=>v.toFixed(1)).join(' × ')+' · 模型单位';
}
// The display group maps each case's anatomical front/up to +Z/+Y.
// Patient right is -X; both jaws receive the same rigid display rotation.
const directions: Record<string,number[]> = { front:[0,0,1],right:[-1,0,0],left:[1,0,0],back:[0,0,-1],upper:[0,-1,0.001],lower:[0,1,0.001],oblique:[0,-0.55,1] };
function setView(id: string) { activeView=id; const d=directions[id]; controls.enableDamping=false;controls.update();camera.up.set(0,1,0);camera.position.copy(controls.target).add(new THREE.Vector3(...d).normalize().multiplyScalar(radius*4)); controls.update();controls.enableDamping=true; document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{const active=b.dataset.view===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}); fit(); }
function applyCaseOrientation() {
  const mode=$<HTMLSelectElement>('orientation').value;
  if(mode!=='auto') {
    group.rotation.set(mode==='z'?-Math.PI/2:0,0,0);
    $('orientation-status').textContent='使用指定坐标轴，可旋转模型后设为正面';
  } else {
    const saved=localResults?calibratedCases.get(localCases[loadedCase]):undefined;
    if(saved) {
      group.quaternion.copy(saved);
      $('orientation-status').textContent='已使用本次会话保存的正面校准';
    } else {
      const result=estimateArchFrame(models.map(model=>({positions:model.source.getAttribute('position').array,jaw:model.jaw})));
      $('orientation-status').textContent=result.reason;
      if(result.frame) {
        const up=new THREE.Vector3(...result.frame.up),front=new THREE.Vector3(...result.frame.front);
        const basis=new THREE.Matrix4().makeBasis(up.clone().cross(front).normalize(),up,front);
        group.quaternion.setFromRotationMatrix(basis).invert();
      } else {
        group.rotation.set(-Math.PI/2,0,0);
        toast(result.reason);
      }
    }
  }
  initialOrientation.copy(group.quaternion);setView('front');
}
function calibrateFront() {
  if(!models.length){toast('请先加载牙模');return;}
  controls.enableDamping=false;controls.update();camera.updateMatrixWorld();
  const front=camera.position.clone().sub(controls.target).normalize();
  const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1).normalize();
  const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(front),up,front)).invert();
  group.quaternion.premultiply(rotation);initialOrientation.copy(group.quaternion);
  $<HTMLSelectElement>('orientation').value='auto';
  if(localResults && localCases[loadedCase])calibratedCases.set(localCases[loadedCase],group.quaternion.clone());
  $('orientation-status').textContent='已将当前视角设为正面（本次会话有效）';
  setView('front');toast('正面已校准，所有快速视角同步更新');
}
renderer.domElement.addEventListener('pointerdown',event=>{if(event.button===0&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey)document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});});
function applyVisibility() { const filter=$<HTMLSelectElement>('filter').value; for(const model of models) model.mesh.visible=model.enabled&&(filter==='all'||model.jaw===filter); const visible=models.filter(m=>m.mesh.visible); $('status').textContent = loading ? '正在读取模型…' : visible.length ? `${visible.length} 个模型 · ${visible.reduce((s,m)=>s+m.triangles,0).toLocaleString()} 个三角面` : models.length ? '当前筛选下没有可见模型' : '等待选择数据文件夹'; $('empty').hidden=!!models.length || !!loading; }
function renderList() {
  $('model-count').textContent=`${models.length} 个模型`; $('models').replaceChildren();
  for(const model of models) {
    const row=document.createElement('div'); row.className='model-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=model.enabled;check.setAttribute('aria-label',`显示 ${model.name}`);check.onchange=()=>{model.enabled=check.checked;applyVisibility();fit();};
    const info=document.createElement('div');info.className='model-info';const name=document.createElement('strong');name.textContent=model.name;name.title=model.name;const detail=document.createElement('small');detail.textContent=`${model.triangles.toLocaleString()} 个三角面`;info.append(name,detail);
    const jaw=document.createElement('select');jaw.setAttribute('aria-label',`${model.name} 所属颌面`);for(const [value,label] of [['upper','上颌'],['lower','下颌'],['other','其他']])jaw.add(new Option(label,value));jaw.value=model.jaw;jaw.disabled=localResults;jaw.onchange=()=>{invalidateSegmentation(model);model.jaw=jaw.value as Model['jaw'];applyVisibility();fit();void runSegmentation();};
    const remove=document.createElement('button');remove.className='remove';remove.textContent='×';remove.title=`移除 ${model.name}`;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{segmentationGeneration++;segmentationAbort?.abort();segmentationRunning=false;segmentationMessage='';group.remove(model.mesh);model.source.dispose();model.refined?.dispose();model.mesh.material.dispose();models.splice(models.indexOf(model),1);renderList();fit();void runSegmentation();};
    row.append(check,info,jaw,remove);$('models').append(row);
  } applyVisibility();updateSegmentationState();
}
function addBuffer(buffer: ArrayBuffer, name: string, result?: unknown, refinementUrl?: string) {
  const topology=/\.obj$/i.test(name)?objTopology(buffer):undefined;
  let geometry=topology?expandedGeometry(topology):parseModelGeometry(buffer,name); const position=geometry.getAttribute('position');
  const triangles=position.count/3;
  geometry.deleteAttribute('normal');geometry.deleteAttribute('color');const original=geometry;geometry=mergeVertices(geometry,0.00001);original.dispose();geometry.computeVertexNormals();geometry.computeBoundingBox();
  const welded=geometry;geometry=welded.toNonIndexed();welded.dispose();
  if(result!==undefined){try{packRefinement(geometry.getAttribute('position').array as Float32Array,result,topology);}catch(error){geometry.dispose();throw error;}}
  const opacity=Number($<HTMLInputElement>('opacity').value)/100;const surface=$<HTMLSelectElement>('surface').value;
  const material=new THREE.MeshStandardMaterial({color:0xc7a775,roughness:0.65,metalness:0,side:THREE.DoubleSide,opacity,transparent:opacity<1,depthWrite:opacity===1,flatShading:surface==='flat',wireframe:surface==='wire'});
  const mesh=new THREE.Mesh(geometry,material);group.add(mesh);models.push({id:nextId++,name,jaw:inferJaw(name),enabled:true,mesh,triangles,source:geometry,topology,pendingResult:result,refinementUrl});
}
const importFiles = createModelImporter({
  clear: () => clearModels(group, models),
  add: addBuffer,
  onStart: () => {
    segmentationGeneration++;segmentationAbort?.abort();segmentationRunning=false;segmentationMessage='';showToothNumbers=false;importErrors=[];
    loading=1;pendingFit=false;
    $('orientation-status').textContent='正在读取模型，完成后识别牙弓方向';
    $<HTMLButtonElement>('calibrate-front').disabled=true;$<HTMLButtonElement>('auto-orient').disabled=true;
    $('dimensions').textContent='模型坐标单位';
    $('toast').hidden=true;clearTimeout(toastTimer);
    selectStep(steps[0]);renderList();
  },
  onFinish: added => {
    loading=0;
    $<HTMLButtonElement>('calibrate-front').disabled=!added;$<HTMLButtonElement>('auto-orient').disabled=!added;
    if(added)$<HTMLSelectElement>('filter').value='all';
    if(localResults)segmentationMessage=importErrors.length?`本地结果加载失败：${importErrors.join('；')}`:'';
    renderList();if(added)applyCaseOrientation();else fit();
    if(added)void runSegmentation();
  },
  onError: message=>{importErrors.push(message);toast(message);},
});
function uploadSingle(files:File[]){if(!files.length)return;if(adjustment?.active){adjustment.guard(()=>uploadSingle(files));return;}localResults=false;localCases=[];$('case-picker').hidden=true;void importFiles(files);}
function loadCase(index:number){
  if(adjustment?.active){$<HTMLSelectElement>('case-select').value=String(loadedCase);adjustment.guard(()=>loadCase(index));return;}
  const item=localCases[index];if(!item)return;
  loadedCase=index;$<HTMLSelectElement>('case-select').value=String(index);localResults=true;
  void importFiles(item.entries.map(entry=>entry.file),new Map(item.entries.map(entry=>[entry.file,entry.result])),new Map(item.entries.map(entry=>[entry.file,entry.refinementUrl])));
}
let loadedCase=0;
function showCases(cases:LocalCase[]){
  localCases=cases;
  const select=$<HTMLSelectElement>('case-select');select.replaceChildren();
  localCases.forEach((item,index)=>select.add(new Option(item.name,String(index))));
  $('case-picker').hidden=localCases.length<2;loadCase(0);
}
function loadPreloaded(){
  if(adjustment?.active){adjustment.guard(loadPreloaded);return;}
  showCases(createPreloadedCases(preloadedCatalog,import.meta.env.BASE_URL));
}
function uploadFolder(files:File[]){
  if(adjustment?.active){adjustment.guard(()=>uploadFolder(files));return;}
  const discovered=discoverCases(files);
  if(!discovered.length){toast('文件夹中未找到以 _upper / _lower 命名的 STL 或 OBJ 模型');return;}
  showCases(discovered);
}
const folderInput=$<HTMLInputElement>('folder-input');
folderInput.onchange=()=>{
  const files=Array.from(folderInput.files||[]);folderInput.value='';if(!files.length)return;
  uploadFolder(files);
};
$('case-select').onchange=()=>loadCase(Number($<HTMLSelectElement>('case-select').value));
const input=$<HTMLInputElement>('file-input');input.onchange=()=>{uploadSingle(Array.from(input.files||[]));input.value='';};
for(const id of ['import','add-model','empty-import']) $(id).onclick=()=>folderInput.click();
$('single-import').onclick=()=>input.click();
for(const id of ['preloaded-import','empty-preloaded']) $(id).onclick=loadPreloaded;
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view!));
$('filter').onchange=()=>{applyVisibility();fit();};
$('panel-toggle').onclick=()=>{$('panel').hidden=!$('panel').hidden;};
$('fit').onclick=fit;$('reset').onclick=()=>{group.quaternion.copy(initialOrientation);setView('front');};
$('orientation').onchange=applyCaseOrientation;
$('calibrate-front').onclick=calibrateFront;
$('auto-orient').onclick=()=>{if(!models.length){toast('请先加载牙模');return;}if(localResults&&localCases[loadedCase])calibratedCases.delete(localCases[loadedCase]);$<HTMLSelectElement>('orientation').value='auto';applyCaseOrientation();};
document.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach(b=>b.onclick=()=>{group.rotateOnWorldAxis(new THREE.Vector3(b.dataset.rotate==='x'?1:0,b.dataset.rotate==='y'?1:0,b.dataset.rotate==='z'?1:0),Math.PI/2);fit();});
$('surface').onchange=()=>{for(const m of models){m.mesh.material.flatShading=$<HTMLSelectElement>('surface').value==='flat';m.mesh.material.wireframe=$<HTMLSelectElement>('surface').value==='wire';m.mesh.material.needsUpdate=true;}};
$('opacity').oninput=()=>{const value=Number($<HTMLInputElement>('opacity').value);$('opacity-value').textContent=value+'%';for(const m of models){m.mesh.material.opacity=value/100;m.mesh.material.transparent=value<100;m.mesh.material.depthWrite=value===100;}};
$('screenshot').onclick=()=>{renderFrame();renderer.domElement.toBlob(blob=>{if(!blob){toast('截图失败');return;}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`STL-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
let dragDepth=0;window.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;uploadSingle(Array.from(e.dataTransfer?.files||[]));});
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || $('workspace').hidden)return;if(e.key.toLowerCase()==='f')fit();});
function segmentationReady(){return !loading&&!segmentationRunning&&!!models.length&&models.every(model=>!!model.teeth)&&(!localResults||!importErrors.length);}
function updateSegmentationState(){
  const ready=segmentationReady(),busy=!!loading||segmentationRunning;
  const step=document.querySelector<HTMLButtonElement>('[data-step="分牙"]')!;
  step.disabled=!ready;step.classList.toggle('busy',busy);step.classList.toggle('ready',ready);step.setAttribute('aria-busy',String(busy));
  step.title=busy?(segmentationMessage||'正在准备分牙并强平滑，完成后可进入'):ready?'分牙完成，点击查看':models.length?'分牙尚未完成':'请先上传模型';
  $('segmentation-state').hidden=segmentationActive||!segmentationMessage||busy;
  $('segmentation-state').textContent=segmentationMessage;
  if(models.length&&!busy&&!ready&&(!localResults||!importErrors.length)&&models.every(model=>model.jaw!=='other')){const retry=document.createElement('button');retry.textContent='重试分牙处理';retry.onclick=()=>void runSegmentation();$('segmentation-state').append(retry);}
}
async function runSegmentation(){
  if(localResults&&importErrors.length){updateSegmentationState();return;}
  if(loading||segmentationRunning||!models.length||models.every(model=>model.teeth)){updateSegmentationState();return;}
  const unknown=localResults?[]:models.filter(model=>model.jaw==='other');
  if(unknown.length){segmentationMessage=`请在模型面板为 ${unknown.map(model=>model.name).join('、')} 选择上颌或下颌，随后自动分牙`;$('panel').hidden=false;updateSegmentationState();return;}
  const generation=segmentationGeneration;segmentationRunning=true;segmentationMessage='正在准备自动分牙…';updateSegmentationState();
  try{
    for(const model of [...models]){
      if(model.teeth)continue;
      segmentationAbort=new AbortController();
      const positions=model.source.getAttribute('position').array as Float32Array;
      let result=model.pendingResult;
      if(result===undefined){
        segmentationMessage=`正在分牙 · ${model.jaw==='upper'?'上颌':'下颌'}，请稍候…`;updateSegmentationState();
        const response=await fetch(`/api/segmentation?jaw=${model.jaw}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Blob([positions.slice().buffer]),signal:segmentationAbort.signal});
        if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.detail || `分牙服务不可用（${response.status}），请启动本地 Python 服务`);}
        result=await response.json();
        if(generation!==segmentationGeneration||!models.includes(model))return;
        model.pendingResult=result;
      }
      segmentationMessage=`${model.refinementUrl?'正在读取预载分牙结果':'正在强平滑'} · ${model.jaw==='upper'?'上颌':'下颌'}，请稍候…`;updateSegmentationState();
      const refined=model.refinementUrl
        ? await loadPreloadedRefinement(model.refinementUrl,segmentationAbort.signal)
        : await refineSegmentation(positions,result,localResults?model.topology:undefined,segmentationAbort.signal);
      if(generation!==segmentationGeneration||!models.includes(model)){refined.geometry.dispose();return;}
      model.refined?.dispose();model.refined=refined.geometry;
      model.faceLabels=refined.faceLabels;model.editable=undefined;
      model.teeth=createToothAnnotations(refined.teeth);
      if(segmentationActive)model.mesh.geometry=model.refined;
    }
    segmentationMessage='';
  }catch(error){
    if(generation!==segmentationGeneration)return;
    segmentationMessage=error instanceof Error?error.message:String(error);
    if(segmentationMessage==='Failed to fetch')segmentationMessage=models.some(model=>model.refinementUrl)?'预载分牙数据读取失败，请刷新页面后重试':'无法连接本地处理服务，请启动本地 Python 服务后重试';
  }finally{
    if(generation===segmentationGeneration){segmentationRunning=false;updateSegmentationState();}
  }
}
const toothLabels = new Map<Model,{teeth:ToothAnnotation[];visual:ReturnType<typeof createToothLabels>}>();
function updateToothLabels(){
  for(const [model,entry] of toothLabels){
    if(!models.includes(model)||model.teeth!==entry.teeth){entry.visual.dispose();toothLabels.delete(model);}
  }
  for(const model of models){
    const visible=segmentationActive&&!adjustment?.active&&showToothNumbers&&model.mesh.visible&&!!model.teeth;
    let entry=toothLabels.get(model);
    if(visible&&!entry){
      entry={teeth:model.teeth!,visual:createToothLabels(model.teeth!)};
      toothLabels.set(model,entry);scene.add(entry.visual.group);
    }
    if(!entry)continue;
    entry.visual.group.visible=visible;
    if(visible){model.mesh.updateWorldMatrix(true,false);entry.visual.group.matrix.copy(model.mesh.matrixWorld);}
  }
}
adjustment=createAdjustment({scene,canvas:renderer.domElement,controls,camera:()=>camera,models:()=>models,toast,clearToast,fit,finish:()=>{selectStep(steps[1]);applyVisibility();fit();}});
$('adjust-segmentation').onclick=()=>adjustment!.enter();
function renderFrame(){updateToothLabels();adjustment?.frame();renderer.render(scene,camera);if(gridEnabled && !segmentationActive)referenceGrid.render(renderer,orthographicCamera);}
renderer.setAnimationLoop(()=>{if(!$('workspace').hidden){controls.update();renderFrame();}});resize();applyVisibility();updateSegmentationState();
