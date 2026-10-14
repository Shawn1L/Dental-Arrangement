import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createPreloadedCases, loadPreloadedRefinement } from '../src/preloaded.mjs';
import { createModelImporter } from '../src/model-import.mjs';
const catalog = JSON.parse(await readFile(new URL('../src/preloaded-cases.json', import.meta.url), 'utf8'));

test('12 numbered preloaded cases provide complete, matching OBJ and label pairs', async () => {
  assert.equal(catalog.length, 12);
  for (const [index, item] of catalog.entries()) {
    assert.equal(item.name, `案例-${String(index + 1).padStart(2, '0')}`);
    assert.deepEqual(item.entries.map(e => e.jaw).sort(), ['lower', 'upper']);
    for (const entry of item.entries) {
      const root = new URL(`../public/preloaded/${item.id}/`, import.meta.url);
      const obj = await readFile(new URL(entry.model, root), 'utf8');
      const labels = JSON.parse(await readFile(new URL(entry.result, root), 'utf8')).labels;
      assert.equal(labels.length, (obj.match(/^v /gm) || []).length, `${item.name} ${entry.jaw}`);
      assert.ok(labels.some(label => label > 0));
      assert.equal((await stat(new URL(entry.model, root))).size, entry.size);
    }
  }
});

test('preloaded cases fetch only the selected pair and retain deployment base path', async () => {
  const urls = [];
  const cases = createPreloadedCases(catalog, '/viewer/', async url => {
    urls.push(url); return new Response(url.endsWith('.json') ? '{"labels":[11]}' : 'mesh');
  });
  assert.equal(urls.length, 0);
  const added = [];
  const importer = createModelImporter({ clear() {}, add: (...args) => added.push(args), onStart() {}, onFinish() {}, onError: assert.fail });
  const item = cases[11];
  await importer(item.entries.map(e => e.file), new Map(item.entries.map(e => [e.file, e.result])), new Map(item.entries.map(e => [e.file, e.refinementUrl])));
  assert.equal(urls.length, 4);
  assert.ok(urls.every(url => url.startsWith('/viewer/preloaded/case-12/')));
  assert.equal(added.length, 2);
  assert.equal(added[0][3], '/viewer/preloaded/case-12/case-12_lower.refined.bin.gz');
  assert.deepEqual(added[0][2], { labels: [11] });
});

test('missing preloaded labels report an error instead of importing an unlabeled model', async () => {
  const cases = createPreloadedCases(catalog, '/', async url => new Response('mesh', { status: url.endsWith('.json') ? 404 : 200 }));
  const errors = [], added = [], finished = [];
  const importer = createModelImporter({ clear() {}, add: value => added.push(value), onStart() {}, onFinish: count => finished.push(count), onError: error => errors.push(error) });
  const item = cases[0];
  await importer(item.entries.map(e => e.file), new Map(item.entries.map(e => [e.file, e.result])));
  assert.equal(added.length, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /404/);
  assert.deepEqual(finished, [0]);
});

function compressedRefinement() {
  let header = JSON.stringify({version:1,faces:1}); header += ' '.repeat((4-header.length%4)%4);
  const encoded = new TextEncoder().encode(header), buffer = new ArrayBuffer(4+encoded.length+74);
  new DataView(buffer).setUint32(0,encoded.length,true);new Uint8Array(buffer,4,encoded.length).set(encoded);
  const offset=4+encoded.length;
  new Float32Array(buffer,offset,9).set([0,0,0,1,0,0,0,1,0]);
  new Float32Array(buffer,offset+36,9).fill(1);new Uint16Array(buffer,offset+72,1).fill(11);
  return gzipSync(new Uint8Array(buffer));
}

test('precomputed gzip results decode into editable labels without a refinement POST', async () => {
  const abort = new AbortController(), requests = [];
  const result = await loadPreloadedRefinement('/preloaded/case-01/test.bin.gz', abort.signal, async (url, options) => {
    requests.push({url, options}); return new Response(compressedRefinement());
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.signal, abort.signal);
  assert.equal(requests[0].options.method, undefined);
  assert.deepEqual([...result.faceLabels], [11]);
  assert.equal(result.teeth[0].id,11);
  assert.equal(result.geometry.attributes.position.count,3);
  result.geometry.dispose();
});

test('precomputed loading rejects missing, corrupted, or cancelled results without recomputing', async () => {
  await assert.rejects(loadPreloadedRefinement('/missing', undefined, async () => new Response('',{status:404})), /404/);
  await assert.rejects(loadPreloadedRefinement('/broken', undefined, async () => new Response('not gzip')));
  await assert.rejects(loadPreloadedRefinement('/invalid', undefined, async () => new Response(gzipSync('invalid binary'))));
  const abort = new AbortController();
  await assert.rejects(loadPreloadedRefinement('/cancelled', abort.signal, async () => {
    abort.abort(); return new Response(compressedRefinement());
  }), {name:'AbortError'});
});

test('precomputed results accept gzip already decoded by the HTTP server', async () => {
  const result=await loadPreloadedRefinement('/decoded.bin.gz',undefined,async()=>new Response(gunzipSync(compressedRefinement()),{headers:{'Content-Encoding':'gzip'}}));
  assert.deepEqual([...result.faceLabels],[11]);
  result.geometry.dispose();
});

test('all 24 baked results decode with every original tooth preserved and valid source reconstruction', async () => {
  for (const item of catalog) {
    for (const entry of item.entries) {
      const root=new URL(`../public/preloaded/${item.id}/`,import.meta.url);
      const name=entry.model.replace(/\.obj$/i,'.refined.bin.gz');
      const source=JSON.parse(await readFile(new URL(entry.result,root),'utf8'));
      const result=await loadPreloadedRefinement(name,undefined,async()=>new Response(await readFile(new URL(name,root))));
      try {
        const ids=[...new Set(source.labels.filter(id=>id>0))].sort((a,b)=>a-b);
        assert.deepEqual(result.teeth.map(tooth=>tooth.id),ids,`${item.name} ${entry.jaw}`);
        assert.equal(result.report.preset,'strong');
        assert.ok(result.report.max_source_reconstruction_error<=1e-8);
        assert.equal(result.geometry.attributes.position.count,result.faceLabels.length*3);
      } finally {result.geometry.dispose();}
    }
  }
});
