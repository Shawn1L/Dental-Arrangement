import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import { isTooth, toothColor } from './segmentation.mjs';

// Preserve OBJ vertex/face order even when its material groups are interleaved.
export function objTopology(buffer) {
  const vertices = [], faces = [];
  for (const raw of new TextDecoder().decode(buffer).replace(/\\\r?\n/g, '').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(), parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      if (parts.length < 4) throw new Error('OBJ 顶点需要三个坐标');
      vertices.push(...parts.slice(1, 4).map(Number));
    }
    if (parts[0] === 'f') {
      if (parts.length < 4) throw new Error('OBJ 面片至少需要三个顶点');
      const indices = parts.slice(1).map(p => { const i = Number(p.split('/')[0]); if (!Number.isInteger(i) || !i) throw new Error('OBJ 面片索引无效'); return i > 0 ? i - 1 : vertices.length / 3 + i; });
      for (let i = 1; i + 1 < indices.length; i++) faces.push(indices[0], indices[i], indices[i + 1]);
    }
  }
  if (!faces.length || vertices.length % 3 || vertices.some(x => !Number.isFinite(x)) || faces.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length / 3)) throw new Error('OBJ 坐标或面片索引无效');
  return { vertices: new Float32Array(vertices), faces: new Uint32Array(faces) };
}

export function expandedGeometry(topology) {
  const positions = new Float32Array(topology.faces.length * 3);
  topology.faces.forEach((id, i) => positions.set(topology.vertices.subarray(id * 3, id * 3 + 3), i * 3));
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
}

export function packRefinement(positions, result, topology) {
  const labels = result?.labels;
  if (!Array.isArray(labels) || !labels.length || labels.some(id => id !== 0 && !isTooth(id)) || !labels.some(isTooth)) throw new Error('分牙结果需要 FDI 牙齿标签，牙龈为 0');
  let vertices, faces, mapped;
  if (topology && labels.length === topology.vertices.length / 3) {
    ({ vertices, faces } = topology); mapped = labels;
  } else {
    if (labels.length !== positions.length / 3) throw new Error('标签数量与模型顶点不匹配');
    const lookup = new Map(), coords = [], indices = [], ids = [];
    for (let i = 0; i < labels.length; i++) {
      const xyz = Array.from(positions.subarray(i * 3, i * 3 + 3)), key = xyz.join(',');
      if (xyz.some(x => !Number.isFinite(x))) throw new Error('模型包含无效坐标');
      let index = lookup.get(key);
      if (index === undefined) { index = ids.length; lookup.set(key, index); coords.push(...xyz); ids.push(labels[i]); }
      else if (ids[index] !== labels[i]) throw new Error('同一模型顶点存在冲突分牙标签，请检查原始结果');
      indices.push(index);
    }
    vertices = new Float32Array(coords); faces = new Uint32Array(indices); mapped = ids;
  }
  const header = new Uint32Array([1, vertices.length / 3, faces.length / 3]);
  return new Blob([header, vertices, faces, new Uint16Array(mapped)]);
}

export function decodeRefinement(buffer) {
  if (buffer.byteLength < 4) throw new Error('强平滑返回数据不完整');
  const size = new DataView(buffer).getUint32(0, true);
  if (size % 4 || size + 4 > buffer.byteLength) throw new Error('强平滑返回数据头无效');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
  const n = header.faces, offset = size + 4;
  if (header.version !== 1 || !Number.isInteger(n) || n <= 0 || buffer.byteLength !== offset + n * 74) throw new Error('强平滑返回面片数量不匹配');
  const positions = new Float32Array(buffer, offset, n * 9), normals = new Float32Array(buffer, offset + n * 36, n * 9);
  const labels = new Uint16Array(buffer, offset + n * 72, n);
  if (positions.some(x => !Number.isFinite(x)) || normals.some(x => !Number.isFinite(x)) || labels.some(id => id !== 0 && !isTooth(id))) throw new Error('强平滑返回坐标或标签无效');
  const colors = new Float32Array(n * 9), sums = new Map(), cache = new Map();
  for (let f = 0; f < n; f++) {
    const id = labels[f];
    if (!cache.has(id)) cache.set(id, new Color(toothColor(id)));
    for (let j = 0; j < 3; j++) cache.get(id).toArray(colors, f * 9 + j * 3);
    if (!id) continue;
    const p = positions.subarray(f * 9, f * 9 + 9);
    const a = [p[3]-p[0], p[4]-p[1], p[5]-p[2]], b = [p[6]-p[0], p[7]-p[1], p[8]-p[2]];
    const area = Math.hypot(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]) / 2;
    const entry = sums.get(id) || { id, center: [0, 0, 0], area: 0 };
    entry.area += area;
    for (let j = 0; j < 3; j++) entry.center[j] += area * (p[j]+p[j+3]+p[j+6]) / 3;
    sums.set(id, entry);
  }
  const teeth = [...sums.values()].filter(t => t.area > 0).map(t => ({ id: t.id, center: t.center.map(x => x / t.area) })).sort((a,b) => a.id-b.id);
  if (!teeth.length) throw new Error('强平滑结果没有牙齿');
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3)).setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  return { geometry, teeth, report: header.report };
}

export async function refineSegmentation(positions, result, topology, signal) {
  const response = await fetch('/api/segmentation/refine', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: packRefinement(positions, result, topology), signal });
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.detail || '强平滑服务不可用，请启动本地 Python 服务后重新加载'); }
  return decodeRefinement(await response.arrayBuffer());
}
