import { buildBoundaryCurves } from './boundary-curves.mjs';
import { isControlPointVisible } from './control-point-visibility.mjs';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createToothAnnotations, toothColor, type ToothAnnotation } from './segmentation.mjs';
import { createToothLabels } from './tooth-labels';
import { createEditableJaw, regionCenters, activeRegions, boundaryLoops, prepareBoundaryControls, controlIndices, boundaryReplacement, moveBoundary, applyLasso, renumber, setMark, deleteRegion, EditSession, type EditableJaw, type BoundaryLoop } from './segmentation-editor.mjs';

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
  const raycaster=new THREE.Raycaster(),visibilityRaycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();raycaster.firstHitOnly=visibilityRaycaster.firstHitOnly=true;
  const boundaryLineWidth=4; // CSS pixels, independent of camera zoom.
  Object.assign(raycaster.params,{Line2:{threshold:10-boundaryLineWidth}});
  function boundaryMaterial(color:string){return new LineMaterial({color,linewidth:boundaryLineWidth,worldUnits:false,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4,toneMapped:false});}
  let preview:LineSegments2|undefined;
  let hoveredLine:LineSegments2|undefined,hoveredPoint:{mesh:THREE.InstancedMesh;index:number}|undefined;
  const lime=new THREE.Color('#00FF00');
  function clearHover(){
    if(hoveredLine)(hoveredLine.material as LineMaterial).color.set(hoveredLine.userData.key===selected?'#ffffff':'#27c778');
    if(hoveredLine)hoveredLine.renderOrder=hoveredLine.userData.key===selected?2:1;
    if(hoveredPoint){const {mesh,index}=hoveredPoint;mesh.setColorAt(index,new THREE.Color(mesh.userData.handles[index].key===selected?'#30be87':'#409dff'));mesh.instanceColor!.needsUpdate=true;}
    hoveredLine=undefined;hoveredPoint=undefined;host.canvas.style.cursor='';
  }
  function selectBoundary(key:number){
    clearHover();selected=key;
    for(const layer of visuals)layer.traverse(object=>{
      if(object instanceof LineSegments2&&object.userData.key){(object.material as LineMaterial).color.set(object.userData.key===selected?'#ffffff':'#27c778');object.renderOrder=object.userData.key===selected?2:1;}
      if(object instanceof THREE.InstancedMesh&&object.userData.handles){object.userData.choices.forEach((choices:Handle[],i:number)=>{const handle=choices.find(h=>h.key===selected)??choices[0];object.userData.handles[i]=handle;object.setColorAt(i,new THREE.Color(handle.key===selected?'#30be87':'#409dff'));});object.instanceColor!.needsUpdate=true;}
    });
    $<HTMLButtonElement>('delete-boundary').disabled=!key;
  }
  let gesture:{pointer:number;points:number[][];key:number;dragging?:boolean;handle?:Handle;target?:number[];marker?:{mesh:THREE.InstancedMesh;index:number}}|undefined;
  let gumClick:{pointer:number;start:number[];moved:boolean}|undefined;
  let confirmAction:(()=>void)|undefined;
  function confirm(title:string,message:string,action:()=>void){clearHover();if(gesture)rebuild();$('edit-confirm').querySelector('h2')!.textContent=title;$('edit-confirm').querySelector('p')!.textContent=message;confirmAction=action;dialog.showModal();}
  $('edit-confirm-cancel').onclick=()=>{confirmAction=undefined;dialog.close();};
  $('edit-confirm-continue').onclick=()=>{const action=confirmAction;confirmAction=undefined;dialog.close();action?.();};
  dialog.oncancel=()=>{confirmAction=undefined;};
  function clearVisuals(){clearHover();preview=undefined;labels?.dispose();labels=undefined;for(const object of visuals){object.removeFromParent();object.traverse(o=>{const mesh=o as THREE.Mesh;if(o instanceof THREE.InstancedMesh)o.dispose();mesh.geometry?.dispose();if(mesh.material){for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();}});}visuals.length=0;}
  const loopsCache=new WeakMap<EditableJaw,Map<number,BoundaryLoop[]>>();
  function loopsFor(jaw:EditableJaw,key:number){let cache=loopsCache.get(jaw);if(!cache){cache=new Map();loopsCache.set(jaw,cache);}let loops=cache.get(key);if(!loops){loops=boundaryLoops(jaw,key);cache.set(key,loops);}return loops;}
  function cancelGesture(){gumClick=undefined;if(!gesture)return;const id=gesture.pointer;gesture=undefined;if(host.canvas.hasPointerCapture(id))host.canvas.releasePointerCapture(id);overlay.querySelector('polyline')!.setAttribute('points','');}
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

  const curveCache=new WeakMap<EditableJaw,{loops:BoundaryLoop[];signature:string;segments:Map<number,number[]>}>();
  function projectCurve(point:number[]){const result={point:new THREE.Vector3(),distance:0,faceIndex:0};(current!.refined!.boundsTree as MeshBVH).closestPointToPoint(new THREE.Vector3().fromArray(point),result);return result.point.toArray();}
  function curveSegments(jaw:EditableJaw,entries:{key:number;loop:BoundaryLoop}[]){
    const controls=new Set<number>();for(const {loop} of entries)for(const i of controlIndices(jaw,loop))controls.add(loop.vertices[i]);
    const loops=entries.map(e=>e.loop),signature=[...controls].sort((a,b)=>a-b).join(','),cached=curveCache.get(jaw);
    if(cached?.signature===signature&&cached.loops.length===loops.length&&loops.every((loop,i)=>loop===cached.loops[i]))return cached.segments;
    const segments=new Map<number,number[]>();
    for(const curve of buildBoundaryCurves(jaw,entries,controls,projectCurve))for(const key of curve.keys){
      if(!segments.has(key))segments.set(key,[]);const positions=segments.get(key)!;
      for(let i=1;i<curve.points.length;i++)positions.push(...curve.points[i-1],...curve.points[i]);
    }
    curveCache.set(jaw,{loops,signature,segments});return segments;
  }
  function rebuild(){
    cancelGesture();host.clearToast();clearVisuals();picker.hidden=true;
    if(!active)return;
    const jawName=step<2?'upper':'lower',numbering=step%2===1;
    current=editModels.find(m=>m.jaw===jawName);
    for(const model of editModels){model.mesh.visible=model===current;model.mesh.geometry=model.refined!;model.mesh.material.vertexColors=!numbering&&tool==='lasso';model.mesh.material.color.set(model.mesh.material.vertexColors?0xffffff:0xc7a775);model.mesh.material.opacity=1;model.mesh.material.transparent=false;model.mesh.material.depthWrite=true;model.mesh.material.wireframe=false;model.mesh.material.needsUpdate=true;}
    $('edit-title').textContent=`${numbering?'牙号调整':'分牙调整'}（${jawName==='upper'?'上颌':'下颌'}）`;
    $('edit-guide').textContent=numbering?'点击牙号气泡修改编号或添加特殊标记。':tool==='boundary'?'悬停龈牙线或控制点亮绿，单击选中，拖动控制点调整；也可 Ctrl + 左键选牙。':'从牙齿区域按住左键圈选，松开自动闭合；圈选穿透背面。';
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
    const entries=[...keys].flatMap(key=>loopsFor(jaw,key).map(loop=>({key,loop})));
    if(numbering||tool==='boundary')prepareBoundaryControls(jaw,entries.map(e=>e.loop));
    const curves=numbering||tool==='boundary'?curveSegments(jaw,entries):new Map<number,number[]>();
    if(numbering||tool==='boundary')for(const key of keys) {
      const segments=curves.get(key)??[];
      for(const loop of loopsFor(jaw,key)) {
        if(!numbering)for(const index of controlIndices(jaw,loop)) {
          handles.push({key,loop,index});
        }
      }
      const geometry=new LineSegmentsGeometry().setPositions(segments);
      const line=new LineSegments2(geometry,boundaryMaterial(key===selected&&!numbering?'#ffffff':'#27c778'));line.userData.key=key;line.renderOrder=key===selected?2:1;layer.add(line);
    }
    if(handles.length){
      const byVertex=new Map<number,Handle[]>();
      for(const handle of handles){const vertex=handle.loop.vertices[handle.index];if(!byVertex.has(vertex))byVertex.set(vertex,[]);byVertex.get(vertex)!.push(handle);}
      const choices=[...byVertex.values()],primary=choices.map(list=>list.find(h=>h.key===selected)??list[0]);
      const points=new THREE.InstancedMesh(new THREE.CircleGeometry(.23,24),new THREE.MeshBasicMaterial({depthTest:false,depthWrite:false,transparent:false,toneMapped:false}),primary.length);
      const matrix=new THREE.Matrix4();primary.forEach((handle,i)=>{points.setMatrixAt(i,matrix.makeTranslation(...jaw.vertices[handle.loop.vertices[handle.index]] as [number,number,number]));points.setColorAt(i,new THREE.Color(handle.key===selected?'#30be87':'#409dff'));});
      points.renderOrder=10;points.userData.handles=primary;points.userData.choices=choices;points.userData.positions=primary.map(handle=>new THREE.Vector3().fromArray(jaw.vertices[handle.loop.vertices[handle.index]]));layer.add(points);
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
  function boundaryHit(surface:THREE.Intersection|undefined){
    // Line2 uses a ten CSS pixel hit diameter, including the visible stroke.
    const hits=raycaster.intersectObjects(visuals,true).filter(h=>h.instanceId!==undefined?!!h.object.userData.visible?.[h.instanceId]:!surface||h.distance<=surface.distance+.2);
    const points=hits.filter(h=>h.instanceId!==undefined&&h.object.userData.handles&&h.object.userData.visible?.[h.instanceId]);
    const point=points.find(h=>h.object.userData.handles[h.instanceId!].key===selected&&h.distance<=points[0].distance+.01)??points[0];
    return point??hits.find(h=>h.object instanceof LineSegments2&&h.object.userData.key);
  }
  function hover(e:PointerEvent){
    clearHover();if(!active||!current||step%2||tool!=='boundary'||e.buttons||dialog.open)return;
    setRay(e);frame();const hit=boundaryHit(hitSurface());if(!hit)return;
    if(hit.instanceId!==undefined){hoveredPoint={mesh:hit.object as THREE.InstancedMesh,index:hit.instanceId};hoveredPoint.mesh.setColorAt(hit.instanceId,lime);hoveredPoint.mesh.instanceColor!.needsUpdate=true;}
    else {hoveredLine=hit.object as LineSegments2;(hoveredLine.material as LineMaterial).color.copy(lime);hoveredLine.renderOrder=3;}
    host.canvas.style.cursor='pointer';
  }
  host.controls.addEventListener('change',()=>{if(!gesture)clearHover();});
  host.canvas.addEventListener('pointerleave',clearHover);
  host.canvas.addEventListener('pointerdown',e=>{
    if(!active||!current)return;
    clearHover();gumClick=undefined;if(e.button!==0||e.shiftKey||e.metaKey)return;
    setRay(e);frame();
    const hit=hitSurface(),jaw=current.editable!;
    if(step%2){
      const bubble=labels&&raycaster.intersectObjects(labels.group.children).find(h=>h.object.userData.region&&(!hit||h.distance<=hit.distance+.01));
      if(bubble){stop(e);showPicker(bubble.object.userData.region);}else picker.hidden=true;return;
    }
    if(e.ctrlKey){stop(e);selected=hit?.faceIndex!==undefined?jaw.labels[hit.faceIndex!]:0;rebuild();return;}
    let handleHit:THREE.Intersection|undefined;
    if(tool==='boundary'){
      const boundary=boundaryHit(hit);if(!boundary){
        if(selected&&hit?.faceIndex!==undefined&&jaw.labels[hit.faceIndex!]===0)gumClick={pointer:e.pointerId,start:localPoint(e),moved:false};
        return;
      }
      stop(e);
      if(boundary.instanceId===undefined){selectBoundary(boundary.object.userData.key);hover(e);return;}
      handleHit=boundary;selectBoundary(boundary.object.userData.handles[boundary.instanceId].key);
    }else stop(e);
    gesture={pointer:e.pointerId,points:[localPoint(e)],key:hit?.faceIndex!==undefined?jaw.labels[hit.faceIndex!]:0,handle:handleHit?.instanceId!==undefined?handleHit.object.userData.handles[handleHit.instanceId]:undefined,marker:handleHit?.instanceId!==undefined?{mesh:handleHit.object as THREE.InstancedMesh,index:handleHit.instanceId}:undefined};
    host.canvas.setPointerCapture(e.pointerId);
  },{capture:true});
  host.canvas.addEventListener('pointermove',e=>{
    if(!active)return;
    if(gumClick&&e.pointerId===gumClick.pointer){const [x,y]=localPoint(e);if(Math.hypot(x-gumClick.start[0],y-gumClick.start[1])>=3)gumClick.moved=true;}
    if(!gesture){hover(e);return;}if(e.pointerId!==gesture.pointer)return;stop(e);
    if(gesture.handle&&!gesture.dragging){const [x,y]=localPoint(e),[startX,startY]=gesture.points[0];if(Math.hypot(x-startX,y-startY)<3)return;gesture.dragging=true;}
    if(gesture.handle){setRay(e);const hit=hitSurface();gesture.target=undefined;if(preview)preview.visible=false;
      const original=current!.editable!.vertices[gesture.handle.loop.vertices[gesture.handle.index]];
      const p=hit?current!.mesh.worldToLocal(hit.point.clone()):undefined;
      const path=p&&boundaryReplacement(current!.editable!,gesture.handle.loop,gesture.handle.index,p.toArray());
      const marker=gesture.marker;
      if(marker){marker.mesh.userData.positions[marker.index].fromArray(path?p!.toArray():original);marker.mesh.userData.visibilityDirty=true;marker.mesh.boundingSphere=null;}
      if(path){gesture.target=p!.toArray();if(!preview){preview=new LineSegments2(new LineSegmentsGeometry(),boundaryMaterial('#ffffff'));preview.renderOrder=4;visuals[0].add(preview);}preview.visible=true;preview.geometry.dispose();const jaw=current!.editable!,anchors=new Set(controlIndices(jaw,gesture.handle.loop).map(i=>gesture!.handle!.loop.vertices[i]).filter(v=>path.includes(v)));
        const moved=path.reduce((best,v)=>new THREE.Vector3().fromArray(jaw.vertices[v]).distanceToSquared(p!)<new THREE.Vector3().fromArray(jaw.vertices[best]).distanceToSquared(p!)?v:best,path[0]);anchors.add(moved);
        const coordinates:number[]=[];for(const curve of buildBoundaryCurves(jaw,[{key:gesture.handle.key,loop:{key:gesture.handle.key,vertices:path,closed:true}}],anchors,projectCurve))for(let i=1;i<curve.points.length;i++)coordinates.push(...curve.points[i-1],...curve.points[i]);
        preview.geometry=new LineSegmentsGeometry().setPositions(coordinates);}
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
    else {rebuild();if(g.dragging)host.toast('此位置无法形成有效边界，请缩短拖动距离后重试');}
  }
  host.canvas.addEventListener('pointerup',e=>{
    const click=gumClick;gumClick=undefined;
    if(active&&current&&click?.pointer===e.pointerId&&!click.moved&&e.button===0){
      setRay(e);const hit=hitSurface();
      if(hit?.faceIndex!==undefined&&current.editable!.labels[hit.faceIndex!]===0&&!boundaryHit(hit))selectBoundary(0);
    }
    release(e);hover(e);
  },{capture:true});host.canvas.addEventListener('pointercancel',e=>{gumClick=undefined;release(e,true);clearHover();},{capture:true});
  window.addEventListener('keydown',e=>{if(!active||dialog.open||e.target instanceof HTMLInputElement)return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(gesture)return;if(e.key.toLowerCase()==='y'||e.shiftKey)session?.redo();else session?.undo();syncChanges();rebuild();}});
  function frame(){
    if(!active||!current)return;
    current.mesh.updateWorldMatrix(true,false);
    const camera=host.camera();camera.updateWorldMatrix(true,false);
    const rotation=current.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(camera.getWorldQuaternion(new THREE.Quaternion()));
    const matrix=new THREE.Matrix4(),world=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1),hiddenScale=new THREE.Vector3();
    const viewProjection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    for(const visual of visuals){
      visual.matrix.copy(current.mesh.matrixWorld);
      visual.traverse(object=>{
        if(!(object instanceof THREE.InstancedMesh)||!object.userData.positions)return;
        const data=object.userData;
        const changed=data.visibilityDirty||!data.visibilityCamera?.equals(viewProjection)||!data.visibilityModel?.equals(current!.mesh.matrixWorld);
        if(changed){
          data.visible=data.positions.map((anchor:THREE.Vector3)=>isControlPointVisible(visibilityRaycaster,current!.mesh,camera,world.copy(anchor).applyMatrix4(current!.mesh.matrixWorld)));
          data.visibilityCamera=viewProjection.clone();data.visibilityModel=current!.mesh.matrixWorld.clone();data.visibilityDirty=false;
        }
        // A visible surface anchor gets a complete circle; hidden anchors get
        // no marker and cannot be picked. Marker geometry never clips into teeth.
        data.positions.forEach((anchor:THREE.Vector3,i:number)=>object.setMatrixAt(i,matrix.compose(anchor,rotation,data.visible[i]?scale:hiddenScale)));
        object.instanceMatrix.needsUpdate=true;object.computeBoundingSphere();
      });
      visual.updateWorldMatrix(true,true);
    }
    labels?.group.matrix.copy(current.mesh.matrixWorld);
  }
  return {get active(){return active;},frame,
    guard(action:()=>void){if(!active){action();return;}confirm('退出编辑模式','退出后所有分牙操作将不被保留，请确认是否继续？',()=>{cancel();action();});},
    enter(){
      editModels=host.models().filter(m=>m.refined&&m.faceLabels);
      if(!['upper','lower'].every(j=>editModels.some(m=>m.jaw===j))){host.toast('调整分牙需要完整的上颌和下颌分牙结果');return;}
      for(const model of editModels)if(!model.editable)model.editable=createEditableJaw(model.refined!.getAttribute('position').array as Float32Array,model.faceLabels!);
      session=new EditSession(editModels.map(m=>m.editable!));active=true;step=0;selected=0;tool='boundary';subtract=false;dentition='adult';$<HTMLInputElement>('separate-boundary').checked=false;
      document.body.classList.add('adjustment-stage');ui.hidden=false;host.controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
      for(const model of editModels){const geometry=model.refined!;if(!geometry.boundsTree)geometry.boundsTree=new MeshBVH(geometry,{indirect:true});model.mesh.raycast=acceleratedRaycast;loopsCache.delete(model.editable!);updateModel(model);}
      rebuild();host.fit();
    }
  };
}
