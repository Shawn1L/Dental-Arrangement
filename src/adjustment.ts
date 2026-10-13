import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createToothAnnotations, toothColor, type ToothAnnotation } from './segmentation.mjs';
import { createToothLabels } from './tooth-labels';
import { createEditableJaw, regionCenters, activeRegions, boundaryLoops, controlIndices, boundaryReplacement, moveBoundary, applyLasso, renumber, setMark, deleteRegion, EditSession, type EditableJaw, type BoundaryLoop } from './segmentation-editor.mjs';

export type AdjustmentModel={jaw:string;mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;refined?:THREE.BufferGeometry;faceLabels?:Uint16Array;editable?:EditableJaw;teeth?:ToothAnnotation[]};
type Host={scene:THREE.Scene;canvas:HTMLCanvasElement;controls:OrbitControls;camera:()=>THREE.Camera;models:()=>AdjustmentModel[];toast:(message:string)=>void;clearToast:()=>void;finish:()=>void;fit:()=>void};
type Handle={key:number;loop:BoundaryLoop;index:number};
export function createAdjustment(host:Host) {
  const workspace=document.getElementById('workspace')!;
  const ui=document.createElement('aside');ui.id='adjustment';ui.hidden=true;
  ui.innerHTML=`<div class="edit-heading"><strong>分牙中</strong><button id="edit-exit">退出 ↗</button></div><ol class="edit-progress">${['上颌分牙','上颌牙号','下颌分牙','下颌牙号'].map(t=>`<li>${t}</li>`).join('')}</ol><h2 id="edit-title"></h2><button class="edit-placeholder" disabled title="本阶段暂未开放">步骤选项 ▾</button><p id="edit-guide"></p><div id="edit-tools"><div class="edit-tabs"><button data-tool="boundary">龈牙线工具</button><button data-tool="lasso">牙齿圈选</button></div><div id="boundary-tools"><button class="edit-tool active" disabled>调整龈牙线</button><label class="separate"><input type="checkbox" id="separate-boundary">分离龈牙线公共点</label><button class="edit-tool" disabled>新增龈牙线 · 待开放</button><button class="edit-tool danger" id="delete-boundary" disabled>删除龈牙线</button></div><div id="lasso-tools" hidden><button class="edit-tool" data-lasso="add">增加选中范围</button><button class="edit-tool" data-lasso="subtract">减去选中范围</button></div></div><div class="edit-history"><button id="edit-reset">重置</button><button id="edit-undo">撤销</button><button id="edit-redo">重做</button></div><div class="edit-navigation"><button id="edit-previous">上一步</button><button id="edit-next" class="primary">保存并下一步</button></div><button class="edit-placeholder" disabled>重新提交 AI 生成方案 · 待开放</button><p class="edit-session-note">修改仅在当前页面会话中保存</p>`;
  workspace.append(ui);
  const picker=document.createElement('section');picker.id='tooth-picker';picker.hidden=true;picker.setAttribute('role','dialog');picker.setAttribute('aria-label','选择牙号');
  picker.innerHTML=`<div class="picker-heading"><strong>选择牙号</strong><button id="close-tooth-picker" aria-label="关闭牙号选择">×</button></div><div class="edit-tabs"><button data-dentition="adult">恒牙</button><button data-dentition="child">乳牙</button></div><div id="number-options"></div><div class="mark-options"><button data-mark="B">桥体(B)</button><button data-mark="I">种植体(I)</button><button data-mark="S">标记多生牙(S)</button></div>`;workspace.append(picker);
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.id='lasso-overlay';overlay.innerHTML='<polyline fill="#459cff20" stroke="#2994ff" stroke-width="2" />';workspace.append(overlay);
  const dialog=document.createElement('dialog');dialog.id='edit-confirm';dialog.innerHTML='<h2></h2><p></p><div><button id="edit-confirm-cancel">取消</button><button id="edit-confirm-continue" class="primary">继续</button></div>';document.body.append(dialog);
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  let active=false,step=0,tool='boundary',subtract=false,selected=0,dentition='adult',pickerKey=0;
  let session:EditSession|undefined,editModels:AdjustmentModel[]=[],current:AdjustmentModel|undefined;
  const visuals:THREE.Object3D[]=[];let labels:ReturnType<typeof createToothLabels>|undefined;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();raycaster.firstHitOnly=true;
  let preview:THREE.Line|undefined;
  let gesture:{pointer:number;points:number[][];key:number;handle?:Handle;target?:number[];marker?:{mesh:THREE.InstancedMesh;index:number}}|undefined;
  let confirmAction:(()=>void)|undefined;
  function confirm(title:string,message:string,action:()=>void){if(gesture)rebuild();$('edit-confirm').querySelector('h2')!.textContent=title;$('edit-confirm').querySelector('p')!.textContent=message;confirmAction=action;dialog.showModal();}
  $('edit-confirm-cancel').onclick=()=>{confirmAction=undefined;dialog.close();};
  $('edit-confirm-continue').onclick=()=>{const action=confirmAction;confirmAction=undefined;dialog.close();action?.();};
  dialog.oncancel=()=>{confirmAction=undefined;};
  function clearVisuals(){preview=undefined;labels?.dispose();labels=undefined;for(const object of visuals){object.removeFromParent();object.traverse(o=>{const mesh=o as THREE.Mesh;if(o instanceof THREE.InstancedMesh)o.dispose();mesh.geometry?.dispose();if(mesh.material){for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();}});}visuals.length=0;}
  const loopsCache=new WeakMap<EditableJaw,Map<number,BoundaryLoop[]>>();
  function loopsFor(jaw:EditableJaw,key:number){let cache=loopsCache.get(jaw);if(!cache){cache=new Map();loopsCache.set(jaw,cache);}let loops=cache.get(key);if(!loops){loops=boundaryLoops(jaw,key);cache.set(key,loops);}return loops;}
  function cancelGesture(){if(!gesture)return;const id=gesture.pointer;gesture=undefined;if(host.canvas.hasPointerCapture(id))host.canvas.releasePointerCapture(id);overlay.querySelector('polyline')!.setAttribute('points','');}
  function updateModel(model:AdjustmentModel,patch?:EditSession['lastChanges'][number]){
    const jaw=model.editable!;model.teeth=createToothAnnotations(regionCenters(jaw));
    const colors=model.refined!.getAttribute('color') as THREE.BufferAttribute,cache=new Map<number,THREE.Color>();
    const changedNumbers=new Set(patch?Object.keys(patch.after).map(Number).filter(k=>patch.before[k]?.number!==patch.after[k].number):[]);
    const changedFaces=patch?new Set(patch.indices):undefined;
    colors.clearUpdateRanges();
    jaw.labels.forEach((key,f)=>{if(changedFaces&&!changedFaces.has(f)&&!changedNumbers.has(key))return;if(!cache.has(key))cache.set(key,new THREE.Color(key?(jaw.regions[key].number===null?'#a078b6':toothColor(jaw.regions[key].number!)):'#c7a775'));const color=cache.get(key)!;for(let j=0;j<3;j++)colors.setXYZ(f*3+j,color.r,color.g,color.b);if(patch)colors.addUpdateRange(f*9,9);});
    if(!patch||patch.indices.length||changedNumbers.size)colors.needsUpdate=true;
  }
  function syncChanges(){for(const patch of session?.lastChanges||[]){const model=editModels[patch.j],cache=loopsCache.get(model.editable!);for(const key of patch.old)cache?.delete(key);for(const key of patch.next)cache?.delete(key);updateModel(model,patch);}}

  function rebuild(){
    cancelGesture();host.clearToast();clearVisuals();picker.hidden=true;
    if(!active)return;
    const jawName=step<2?'upper':'lower',numbering=step%2===1;
    current=editModels.find(m=>m.jaw===jawName);
    for(const model of editModels){model.mesh.visible=model===current;model.mesh.geometry=model.refined!;model.mesh.material.vertexColors=!numbering&&tool==='lasso';model.mesh.material.color.set(model.mesh.material.vertexColors?0xffffff:0xc7a775);model.mesh.material.opacity=1;model.mesh.material.transparent=false;model.mesh.material.depthWrite=true;model.mesh.material.wireframe=false;model.mesh.material.needsUpdate=true;}
    $('edit-title').textContent=`${numbering?'牙号调整':'分牙调整'}（${jawName==='upper'?'上颌':'下颌'}）`;
    $('edit-guide').textContent=numbering?'点击牙号气泡修改编号或添加特殊标记。':tool==='boundary'?'Ctrl + 左键选中牙齿，再左键拖动蓝色控制点。':'从牙齿区域按住左键圈选，松开自动闭合；圈选穿透背面。';
    $('edit-tools').hidden=numbering;$('boundary-tools').hidden=tool!=='boundary';$('lasso-tools').hidden=tool!=='lasso';
    ui.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
    ui.querySelectorAll<HTMLButtonElement>('[data-lasso]').forEach(b=>b.classList.toggle('active',(b.dataset.lasso==='subtract')===subtract));
    ui.querySelectorAll('.edit-progress li').forEach((li,i)=>{li.classList.toggle('active',i===step);li.classList.toggle('complete',i<step);li.setAttribute('aria-current',i===step?'step':'false');});
    $<HTMLButtonElement>('edit-previous').disabled=step===0;$('edit-next').textContent=step===3?'保存':'保存并下一步';
    $<HTMLButtonElement>('edit-undo').disabled=!session?.undoStack.length;$<HTMLButtonElement>('edit-redo').disabled=!session?.redoStack.length;
    $<HTMLButtonElement>('delete-boundary').disabled=!current?.editable||!activeRegions(current.editable).has(selected);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{b.disabled=b.dataset.view===(jawName==='upper'?'lower':'upper');});
    if(!current)return;
    const jaw=current.editable!,layer=new THREE.Group();layer.matrixAutoUpdate=false;visuals.push(layer);host.scene.add(layer);
    const keys=activeRegions(jaw);
    if(!keys.has(selected))selected=0;
    const handles:Handle[]=[];
    if(numbering||tool==='boundary')for(const key of keys) {
      const segments:number[]=[];
      for(const loop of loopsFor(jaw,key)) {
        for(let i=1;i<loop.vertices.length;i++)segments.push(...jaw.vertices[loop.vertices[i-1]],...jaw.vertices[loop.vertices[i]]);
        if(!numbering)for(const index of controlIndices(jaw,loop)) {
          handles.push({key,loop,index});
        }
      }
      const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
      layer.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:key===selected&&!numbering?'#ffffff':'#27c778',depthTest:true})));
    }
    if(handles.length){
      const points=new THREE.InstancedMesh(new THREE.SphereGeometry(.23,10,8),new THREE.MeshBasicMaterial({depthTest:true,toneMapped:false}),handles.length);
      const matrix=new THREE.Matrix4();handles.forEach((handle,i)=>{points.setMatrixAt(i,matrix.makeTranslation(...jaw.vertices[handle.loop.vertices[handle.index]] as [number,number,number]));points.setColorAt(i,new THREE.Color(handle.key===selected?'#30be87':'#409dff'));});
      points.userData.handles=handles;layer.add(points);
    }
    if(numbering){labels=createToothLabels(current.teeth!);host.scene.add(labels.group);}
    frame();
  }
  function edit(action:()=>void){if(session?.edit(action))syncChanges();rebuild();}
  function end(){cancelGesture();host.clearToast();active=false;overlay.querySelector('polyline')!.setAttribute('points','');clearVisuals();session=undefined;editModels=[];current=undefined;ui.hidden=picker.hidden=true;document.body.classList.remove('adjustment-stage');document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.disabled=false);host.finish();}
  function restore(){cancelGesture();session?.reset();for(const model of editModels){loopsCache.delete(model.editable!);updateModel(model);}}
  function cancel(){restore();end();}
  $('edit-exit').onclick=()=>confirm('退出编辑模式','退出后所有分牙操作将不被保留，请确认是否继续？',cancel);
  $('edit-reset').onclick=()=>confirm('编辑操作重置','确认后本次上下颌的所有编辑操作将被清空！',()=>{restore();selected=0;rebuild();});
  $('edit-undo').onclick=()=>{session?.undo();syncChanges();rebuild();};$('edit-redo').onclick=()=>{session?.redo();syncChanges();rebuild();};
  $('edit-previous').onclick=()=>{if(step){step--;selected=0;rebuild();host.fit();}};
  $('edit-next').onclick=()=>{if(step<3){step++;selected=0;rebuild();host.fit();}else confirm('编辑方案保存','保存本次上下颌分牙修改并返回展示页？修改仅在当前页面会话有效。',end);};
  ui.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool!;rebuild();});
  ui.querySelectorAll<HTMLButtonElement>('[data-lasso]').forEach(b=>b.onclick=()=>{subtract=b.dataset.lasso==='subtract';rebuild();});
  $('delete-boundary').onclick=()=>{if(current&&selected)edit(()=>deleteRegion(current!.editable!,selected));};
  $('close-tooth-picker').onclick=()=>{picker.hidden=true;};
  function showPicker(key:number){
    pickerKey=key;picker.hidden=false;
    const jaw=current!.editable!,region=jaw.regions[key],quadrants=step<2?(dentition==='adult'?[1,2]:[5,6]):(dentition==='adult'?[4,3]:[8,7]),count=dentition==='adult'?8:5;
    $('number-options').innerHTML=quadrants.map((q,i)=>`<div class="number-arch">${Array.from({length:count},(_,j)=>q*10+(i===0?count-j:j+1)).map(n=>`<button data-number="${n}" class="${region.number===n?'active':''}" title="${[...activeRegions(jaw)].some(k=>k!==key&&jaw.regions[k].number===n)?(region.number===null?'已占用，选择后原牙齿将标记为 S':'已占用，选择后交换编号'):'选择牙号'}">${n}</button>`).join('')}</div>`).join('');
    picker.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(b=>b.onclick=()=>edit(()=>renumber(jaw,key,Number(b.dataset.number))));
    picker.querySelectorAll<HTMLButtonElement>('[data-dentition]').forEach(b=>b.classList.toggle('active',b.dataset.dentition===dentition));
    picker.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach(b=>b.classList.toggle('active',b.dataset.mark==='S'?region.number===null:region.mark===b.dataset.mark));
  }
  picker.querySelectorAll<HTMLButtonElement>('[data-dentition]').forEach(b=>b.onclick=()=>{dentition=b.dataset.dentition!;showPicker(pickerKey);});
  picker.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach(b=>b.onclick=()=>edit(()=>setMark(current!.editable!,pickerKey,b.dataset.mark as 'B'|'I'|'S')));
  function localPoint(e:PointerEvent){const r=host.canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
  function setRay(e:PointerEvent){const [x,y]=localPoint(e),r=host.canvas.getBoundingClientRect();pointer.set(x/r.width*2-1,-y/r.height*2+1);raycaster.setFromCamera(pointer,host.camera());}
  function hitSurface(){current!.mesh.updateWorldMatrix(true,false);return raycaster.intersectObject(current!.mesh)[0];}
  function stop(e:PointerEvent){e.preventDefault();e.stopImmediatePropagation();}
  host.canvas.addEventListener('pointerdown',e=>{
    if(!active||e.button!==0||!current)return;stop(e);setRay(e);frame();
    const hit=hitSurface(),jaw=current.editable!;
    if(step%2){
      const bubble=labels&&raycaster.intersectObjects(labels.group.children).find(h=>h.object.userData.region&&(!hit||h.distance<=hit.distance+.01));
      if(bubble)showPicker(bubble.object.userData.region);else picker.hidden=true;return;
    }
    if(e.ctrlKey){selected=hit?.faceIndex!==undefined?jaw.labels[hit.faceIndex!]:0;rebuild();return;}
    let handleHit:THREE.Intersection|undefined;
    if(tool==='boundary')handleHit=raycaster.intersectObjects(visuals,true).find(h=>h.instanceId!==undefined&&h.object.userData.handles?.[h.instanceId]?.key===selected&&(!hit||h.distance<=hit.distance+.2));
    if(tool==='boundary'&&!handleHit)return;
    gesture={pointer:e.pointerId,points:[localPoint(e)],key:hit?.faceIndex!==undefined?jaw.labels[hit.faceIndex!]:0,handle:handleHit?.instanceId!==undefined?handleHit.object.userData.handles[handleHit.instanceId]:undefined,marker:handleHit?.instanceId!==undefined?{mesh:handleHit.object as THREE.InstancedMesh,index:handleHit.instanceId}:undefined};
    host.canvas.setPointerCapture(e.pointerId);
  },{capture:true});
  host.canvas.addEventListener('pointermove',e=>{
    if(!active||!gesture||e.pointerId!==gesture.pointer)return;stop(e);
    if(gesture.handle){setRay(e);const hit=hitSurface();gesture.target=undefined;if(preview)preview.visible=false;
      const original=current!.editable!.vertices[gesture.handle.loop.vertices[gesture.handle.index]];
      const p=hit?current!.mesh.worldToLocal(hit.point.clone()):undefined;
      const path=p&&boundaryReplacement(current!.editable!,gesture.handle.loop,gesture.handle.index,p.toArray());
      const marker=gesture.marker;
      if(marker){marker.mesh.setMatrixAt(marker.index,new THREE.Matrix4().makeTranslation(...(path?p!.toArray():original) as [number,number,number]));marker.mesh.instanceMatrix.needsUpdate=true;marker.mesh.computeBoundingSphere();}
      if(path){gesture.target=p!.toArray();if(!preview){preview=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#ffffff',depthTest:true}));visuals[0].add(preview);}preview.visible=true;preview.geometry.dispose();preview.geometry=new THREE.BufferGeometry().setFromPoints(path.map(v=>new THREE.Vector3().fromArray(current!.editable!.vertices[v])));}
    }
    else {const p=localPoint(e),last=gesture.points.at(-1)!;if(Math.hypot(p[0]-last[0],p[1]-last[1])>=2)gesture.points.push(p);overlay.querySelector('polyline')!.setAttribute('points',[...gesture.points,gesture.points[0]].map(p=>p.join(',')).join(' '));}
  },{capture:true});
  function release(e:PointerEvent,cancelled=false){
    if(!active||!gesture||e.pointerId!==gesture.pointer)return;stop(e);const g=gesture;gesture=undefined;
    if(host.canvas.hasPointerCapture(e.pointerId))host.canvas.releasePointerCapture(e.pointerId);
    overlay.querySelector('polyline')!.setAttribute('points','');
    if(cancelled){rebuild();return;}
    const jaw=current!.editable!;
    if(g.handle&&g.target){let changed=false;edit(()=>{changed=moveBoundary(jaw,g.handle!.key,g.handle!.loop,g.handle!.index,g.target!,$<HTMLInputElement>('separate-boundary').checked);});if(!changed)host.toast('此位置无法形成有效边界，请缩短拖动距离后重试');}
    else if(!g.handle){if(!g.key){host.toast('请从牙齿区域开始圈选');return;}const r=host.canvas.getBoundingClientRect(),matrix=current!.mesh.matrixWorld.clone(),camera=host.camera();edit(()=>applyLasso(jaw,g.key,g.points,subtract,p=>{const v=new THREE.Vector3().fromArray(p).applyMatrix4(matrix).project(camera);return [(v.x+1)*r.width/2,(1-v.y)*r.height/2,v.z];}));}
    else {rebuild();host.toast('此位置无法形成有效边界，请缩短拖动距离后重试');}
  }
  host.canvas.addEventListener('pointerup',e=>release(e),{capture:true});host.canvas.addEventListener('pointercancel',e=>release(e,true),{capture:true});
  window.addEventListener('keydown',e=>{if(!active||dialog.open||e.target instanceof HTMLInputElement)return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(gesture)return;if(e.key.toLowerCase()==='y'||e.shiftKey)session?.redo();else session?.undo();syncChanges();rebuild();}});
  function frame(){if(!active||!current)return;current.mesh.updateWorldMatrix(true,false);for(const visual of visuals)visual.matrix.copy(current.mesh.matrixWorld);labels?.group.matrix.copy(current.mesh.matrixWorld);}
  return {get active(){return active;},frame,
    guard(action:()=>void){if(!active){action();return;}confirm('退出编辑模式','退出后所有分牙操作将不被保留，请确认是否继续？',()=>{cancel();action();});},
    enter(){
      editModels=host.models().filter(m=>m.refined&&m.faceLabels);
      if(!['upper','lower'].every(j=>editModels.some(m=>m.jaw===j))){host.toast('调整分牙需要完整的上颌和下颌分牙结果');return;}
      for(const model of editModels)if(!model.editable)model.editable=createEditableJaw(model.refined!.getAttribute('position').array as Float32Array,model.faceLabels!);
      session=new EditSession(editModels.map(m=>m.editable!));active=true;step=0;selected=0;tool='boundary';subtract=false;dentition='adult';$<HTMLInputElement>('separate-boundary').checked=false;
      document.body.classList.add('adjustment-stage');ui.hidden=false;host.controls.mouseButtons={LEFT:undefined,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE};
      for(const model of editModels){const geometry=model.refined!;if(!geometry.boundsTree)geometry.boundsTree=new MeshBVH(geometry,{indirect:true});model.mesh.raycast=acceleratedRaycast;loopsCache.delete(model.editable!);updateModel(model);}
      rebuild();host.fit();
    }
  };
}
