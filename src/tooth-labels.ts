import * as THREE from 'three';
import type { ToothAnnotation } from './segmentation.mjs';

// Camera-facing circles stay at their fixed model coordinates and use the same
// depth buffer as the jaws, so occlusion works for part of a circle or line too.
export function createToothLabels(teeth: ToothAnnotation[]) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const textures: THREE.CanvasTexture[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  function circleTexture(text = '') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#42a1ff';
    context.beginPath();context.arc(64, 64, 62, 0, Math.PI * 2);context.fill();
    if (text) {
      context.fillStyle = '#fff';context.font = '35px "Segoe UI", "Microsoft YaHei", sans-serif';
      context.textAlign = 'center';context.textBaseline = 'middle';context.fillText(text, 64, 65);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;textures.push(texture);
    return texture;
  }
  function sprite(texture: THREE.Texture, position: number[], radius: number) {
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, transparent: true, toneMapped: false });
    materials.push(material);
    const bubble = new THREE.Sprite(material);
    bubble.position.set(...position as [number, number, number]);bubble.scale.set(radius * 2, radius * 2, 1);
    bubble.renderOrder = 2;group.add(bubble);
  }
  const marker = circleTexture();
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#70b5ff', depthTest: true, depthWrite: false, transparent: true, toneMapped: false });
  materials.push(lineMaterial);
  for (const tooth of teeth) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...tooth.center), new THREE.Vector3(...tooth.labelCenter)]);
    geometries.push(geometry);
    const line = new THREE.Line(geometry, lineMaterial);line.renderOrder = 1;group.add(line);
    sprite(marker, tooth.center, tooth.labelRadius * .14);
    sprite(circleTexture(String(tooth.id)), tooth.labelCenter, tooth.labelRadius);
  }
  return { group, dispose() {
    group.removeFromParent();textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());geometries.forEach(geometry => geometry.dispose());
  } };
}
