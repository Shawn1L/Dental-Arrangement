// Validate before STLLoader allocates geometry. STL has no standardized unit.
export function validateSTL(buffer) {
  if (buffer.byteLength < 15) throw new Error('文件过短，不是有效的 STL。');
  const view = new DataView(buffer);
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) {
      if (!count) throw new Error('STL 中没有三角面。');
      for (let i = 84; i < buffer.byteLength; i += 50) {
        for (let j = 12; j < 48; j += 4) {
          if (!Number.isFinite(view.getFloat32(i + j, true))) throw new Error('STL 包含无效坐标。');
        }
      }
      return;
    }
  }
  const text = new TextDecoder().decode(buffer);
  if (!/^\s*solid\b/i.test(text) || !/endsolid\b/i.test(text) || !/facet\s+normal/i.test(text)) {
    throw new Error('STL 格式不正确或文件已损坏。');
  }
}
export function inferJaw(name) {
  if (/上颌|上牙|upper|maxilla/i.test(name)) return 'upper';
  if (/下颌|下牙|lower|mandib/i.test(name)) return 'lower';
  return 'other';
}
