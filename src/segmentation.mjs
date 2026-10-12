import { Color, Float32BufferAttribute } from 'three';

export const GUM_COLOR = '#c7a775';
const light = ['#5279c7', '#9470be', '#c05b96', '#77b744', '#50b9b6', '#cc8a70', '#6867bb', '#b59e69'];
const dark = ['#304e97', '#8050ad', '#b24b8c', '#579d30', '#279c9b', '#ad694f', '#494b9a', '#947d50'];
export function isTooth(id) { return Number.isInteger(id) && id >= 11 && id <= 48 && id % 10 >= 1 && id % 10 <= 8; }
export function toothColor(id) {
  if (!isTooth(id)) return GUM_COLOR;
  const quadrant = Math.floor(id / 10);
  return (quadrant === 1 || quadrant === 3 ? light : dark)[id % 10 - 1];
}

// Anchors live in the model's XY dental arch plane, independent of the camera,
// visible jaw filter, and other projected bubbles. Overlap is intentional.
export function createToothAnnotations(teeth) {
  if (!teeth.length) return [];
  const center = [0, 0];
  for (const tooth of teeth) { center[0] += tooth.center[0]; center[1] += tooth.center[1]; }
  center[0] /= teeth.length; center[1] /= teeth.length;
  const width = Math.max(...teeth.map(t => t.center[0])) - Math.min(...teeth.map(t => t.center[0]));
  const depth = Math.max(...teeth.map(t => t.center[1])) - Math.min(...teeth.map(t => t.center[1]));
  const span = Math.max(width, depth, 1);
  return teeth.map(tooth => {
    const dx = tooth.center[0] - center[0], dy = tooth.center[1] - center[1];
    const length = Math.hypot(dx, dy);
    const direction = length > 1e-8 ? [dx / length, dy / length] : [0, -1];
    return { ...tooth, labelCenter: [tooth.center[0] + direction[0] * span * .16, tooth.center[1] + direction[1] * span * .16, tooth.center[2]], labelRadius: span * .038 };
  });
}

// OBJLoader expands faces in source order. Keep the original vertex indices so
// per-vertex inference labels survive triangulation and the viewer's welding.
export function objVertexMap(buffer) {
  const indices = []; let count = 0;
  const text = new TextDecoder().decode(buffer).replace(/\\\r?\n/g, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^v\s/.test(line)) count++;
    else if (/^f\s/.test(line)) {
      const face = line.split(/\s+/).slice(1).filter(part => !part.startsWith('#')).map(part => {
        const index = Number(part.split('/')[0]);
        return index > 0 ? index - 1 : count + index;
      });
      for (let i = 1; i + 1 < face.length; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  return { count, indices: new Uint32Array(indices) };
}

export function labelGeometry(geometry, result, sourceMap) {
  const labels = result?.labels;
  if (!Array.isArray(labels) || !labels.length) throw new Error('分牙结果需要非空 labels 数组');
  if (labels.some(id => id !== 0 && !isTooth(id))) throw new Error('牙号必须为 FDI 11–48，牙龈为 0');
  const position = geometry.getAttribute('position');
  const mapping = sourceMap && labels.length === sourceMap.count ? sourceMap.indices : null;
  if ((!mapping && labels.length !== position.count) || (mapping && mapping.length !== position.count)) throw new Error('标签数量与上传模型顶点不匹配，请使用同一模型的分牙结果');
  const colors = new Float32Array(position.count * 3);
  const cache = new Map(); const sums = new Map();
  for (let i = 0; i < position.count; i++) {
    const id = labels[mapping ? mapping[i] : i];
    if (id === undefined) throw new Error('分牙结果包含无效的顶点索引');
    if (!cache.has(id)) cache.set(id, new Color(toothColor(id)));
    cache.get(id).toArray(colors, i * 3);
    if (id) {
      const entry = sums.get(id) || { id, center: [0, 0, 0], count: 0 };
      entry.center[0] += position.getX(i); entry.center[1] += position.getY(i); entry.center[2] += position.getZ(i); entry.count++;
      sums.set(id, entry);
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return [...sums.values()].map(entry => ({ id: entry.id, center: entry.center.map(value => value / entry.count) })).sort((a, b) => a.id - b.id);
}
