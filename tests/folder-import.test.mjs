import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverCases } from '../src/folder-import.mjs';
import { createModelImporter } from '../src/model-import.mjs';

const file = path => ({ name: path.split('/').at(-1), webkitRelativePath: path, size: 10, arrayBuffer: async () => new ArrayBuffer(10), text: async () => '{"labels":[11]}' });
test('root folder separates cases, pairs adjacent JSON and prefers OBJ over duplicates', () => {
  const paths = ['root/p1/c1/obj/p1_c1_upper.obj', 'root/p1/c1/obj/p1_c1_upper.json',
    'root/p1/c1/stl/p1_c1_upper.stl', 'root/p1/c1/stl/p1_c1_upper.json',
    'root/p1/c1/obj/p1_c1_lower.obj', 'root/p1/c1/obj/p1_c1_lower.json',
    'root/p1/c1/obj/p1_c1_ul.obj', 'root/p1/c1/stl/p1_c1_upper_only_tooth.stl',
    'root/p2/c2/obj/p2_c2_upper.obj', 'root/p2/c2/obj/p2_c2_upper.json'];
  const cases = discoverCases(paths.map(file));
  assert.equal(cases.length, 2);
  assert.deepEqual(cases[0].entries.map(entry => entry.file.name), ['p1_c1_upper.obj', 'p1_c1_lower.obj']);
  assert.ok(cases.every(item => item.entries.every(entry => entry.result)));
});
test('complete STL pair wins over OBJ without result, and unrelated JSON cannot pair', () => {
  const cases = discoverCases(['root/obj/a_upper.obj', 'root/stl/a_upper.stl', 'root/stl/a_upper.json', 'root/obj/a_lower.obj', 'root/else/a_lower.json'].map(file));
  assert.equal(cases.length, 1);
  assert.equal(cases[0].entries[0].file.name, 'a_upper.stl');
  assert.equal(cases[0].entries[1].result, undefined);
});
test('local import reads companions and reports missing or malformed JSON without adding models', async () => {
  const added = [], errors = [];
  const upload = createModelImporter({ clear: () => {}, add: (...args) => added.push(args), onStart: () => {}, onFinish: () => {}, onError: message => errors.push(message) });
  const upper = file('a_upper.obj'), lower = file('a_lower.obj');
  await upload([upper, lower], new Map([[upper, file('a_upper.json')]]));
  assert.deepEqual(added[0][2], { labels: [11] });
  assert.equal(added.length, 1);
  assert.match(errors[0], /缺少同名/);
  await upload([lower], new Map([[lower, { text: async () => 'invalid' }]]));
  assert.equal(added.length, 1);
  assert.equal(errors.length, 2);
});
test('late JSON read cannot add results to a newly selected case', async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const added = [], finishes = [];
  const upload = createModelImporter({ clear: () => { added.length = 0; }, add: (_, name) => added.push(name), onStart: () => {}, onFinish: n => finishes.push(n), onError: () => assert.fail('unexpected error') });
  const old = file('old_upper.obj'), latest = file('latest_upper.obj');
  const first = upload([old], new Map([[old, { text: () => pending }]]));
  await Promise.resolve();
  await upload([latest], new Map([[latest, file('latest_upper.json')]]));
  resolve('{"labels":[21]}');await first;
  assert.deepEqual(added, ['latest_upper.obj']);
  assert.deepEqual(finishes, [1]);
});
