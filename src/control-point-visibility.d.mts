import type { Camera, Mesh, Raycaster, Vector3 } from 'three';
export function isControlPointVisible(raycaster:Raycaster,mesh:Mesh,camera:Camera,anchor:Vector3,tolerance?:number):boolean;
