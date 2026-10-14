import { decodeRefinement } from './segmentation-refinement.mjs';

// Read only the selected case, using the same importer as local folder data.
export function createPreloadedCases(catalog, baseUrl, request = fetch) {
  const remoteFile = (url, name, size = 0) => {
    const read = async () => {
      const response = await request(url);
      if (!response.ok) throw new Error(`预载文件读取失败（${response.status}），请重试`);
      return response;
    };
    return { name, size, arrayBuffer: async () => (await read()).arrayBuffer(), text: async () => (await read()).text() };
  };
  return catalog.map(item => ({
    id: item.id, name: item.name,
    entries: item.entries.map(entry => ({
      jaw: entry.jaw,
      refinementUrl: `${baseUrl}preloaded/${item.id}/${entry.model.replace(/\.obj$/i, '.refined.bin.gz')}`,
      file: remoteFile(`${baseUrl}preloaded/${item.id}/${entry.model}`, entry.model, entry.size),
      result: remoteFile(`${baseUrl}preloaded/${item.id}/${entry.result}`, entry.result),
    })),
  }));
}

// These assets contain the same verified binary result as the local refinement API.
export async function loadPreloadedRefinement(url, signal, request = fetch) {
  const response = await request(url, { signal });
  if (!response.ok) throw new Error(`预载分牙结果读取失败（${response.status}），请重新生成预载数据后重试`);
  const compressed = await response.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // Some servers set Content-Encoding: gzip, so fetch already decompresses the body.
  const bytes = new Uint8Array(compressed);
  const buffer = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : compressed;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return decodeRefinement(buffer);
}
