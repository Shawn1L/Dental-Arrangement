import { Mesh } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { validateSTL } from './stl.mjs';

// Return one surface per file, preserving coordinates across OBJ groups.
// Materials, textures, lines and points are not part of the dental surface.
export function parseModelGeometry(buffer, name) {
  let geometry;
  if (/\.stl$/i.test(name)) {
    validateSTL(buffer);
    geometry = new STLLoader().parse(buffer);
  } else if (/\.obj$/i.test(name)) {
    const text = new TextDecoder().decode(buffer).replace(/^\uFEFF/, '');
    const object = new OBJLoader().parse(text);
    const parts = [];
    object.updateMatrixWorld(true);
    try {
      object.traverse(child => {
        if (!(child instanceof Mesh)) return;
        const part = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
        part.applyMatrix4(child.matrixWorld);
        for (const attribute of Object.keys(part.attributes)) if (attribute !== 'position') part.deleteAttribute(attribute);
        parts.push(part);
      });
      if (!parts.length) throw new Error('OBJ 中没有可显示的三角面，请上传含面的模型。');
      geometry = mergeGeometries(parts);
      if (!geometry) throw new Error('OBJ 中的模型分组无法合并。');
    } finally {
      for (const part of parts) part.dispose();
      object.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) material.dispose();
      });
    }
  } else {
    throw new Error('仅支持 STL / OBJ 文件。');
  }
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3 || position.count % 3) {
    geometry.dispose(); throw new Error('没有有效的三角面。');
  }
  for (const coordinate of position.array) {
    if (!Number.isFinite(coordinate)) {
      geometry.dispose(); throw new Error('模型包含无效坐标或面索引。');
    }
  }
  return geometry;
}
