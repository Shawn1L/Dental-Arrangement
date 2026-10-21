import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isControlPointVisible } from '../src/control-point-visibility.mjs';

for(const orthographic of [false,true])test(`control marker anchor occlusion on sloped surfaces (${orthographic?'orthographic':'perspective'})`,()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());mesh.rotation.y=.35;mesh.updateWorldMatrix(true,false);
  const camera=orthographic?new THREE.OrthographicCamera(-3,3,3,-3,.1,30):new THREE.PerspectiveCamera(40,1,.1,30);
  camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateWorldMatrix(true,false);camera.updateProjectionMatrix();
  const ray=new THREE.Raycaster(),front=mesh.localToWorld(new THREE.Vector3(0,0,1)),back=mesh.localToWorld(new THREE.Vector3(0,0,-1));
  assert.equal(isControlPointVisible(ray,mesh,camera,front),true,'surface anchor should receive a complete marker');
  assert.equal(isControlPointVisible(ray,mesh,camera,back),false,'model hides the back anchor');
  assert.equal(isControlPointVisible(ray,mesh,camera,new THREE.Vector3(0,0,10)),false,'anchor behind camera is hidden');
  mesh.geometry.dispose();mesh.material.dispose();
});
