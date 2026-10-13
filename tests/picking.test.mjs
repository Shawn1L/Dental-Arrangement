import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

test('accelerated picking preserves nonindexed face order and world-space hits',()=>{
  const coordinates=[];
  for(let i=0;i<40;i++){const x=(39-i)*2;coordinates.push(x,0,0,x+1,0,0,x,1,0);}
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(coordinates,3));
  const before=geometry.attributes.position.array.slice();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.position.set(3,4,5);mesh.rotation.y=.3;mesh.updateMatrixWorld();
  const caster=new THREE.Raycaster();caster.firstHitOnly=true;
  const rays=[0,7,22,39].map(face=>{const target=new THREE.Vector3((39-face)*2+.2,.2,0).applyMatrix4(mesh.matrixWorld);const direction=new THREE.Vector3(0,0,-1).transformDirection(mesh.matrixWorld);return {origin:target.clone().addScaledVector(direction,-10),direction};});
  const expected=rays.map(r=>{caster.set(r.origin,r.direction);return caster.intersectObject(mesh)[0];});
  geometry.boundsTree=new MeshBVH(geometry,{indirect:true});mesh.raycast=acceleratedRaycast;
  rays.forEach((r,i)=>{caster.set(r.origin,r.direction);const hit=caster.intersectObject(mesh)[0];assert.equal(hit.faceIndex,expected[i].faceIndex);assert.ok(hit.point.distanceTo(expected[i].point)<1e-8);});
  assert.equal(geometry.index,null);assert.deepEqual(geometry.attributes.position.array,before);
  geometry.dispose();mesh.material.dispose();
});
