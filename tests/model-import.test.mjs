import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { clearModels, createModelImporter } from '../src/model-import.mjs';
import { parseModelGeometry } from '../src/model-loader.mjs';

const triangle = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3').buffer;
const file = name => ({ name, size: triangle.byteLength, arrayBuffer: async () => triangle });
function deferredFile(name) {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { name, size: triangle.byteLength, arrayBuffer: () => promise, resolve, reject };
}
function viewer() {
  const group = new Group(), models = [], errors = [], finishes = [];
  let loading = false;
  const upload = createModelImporter({
    clear: () => clearModels(group, models),
    add: (buffer, name) => {
      const mesh = new Mesh(parseModelGeometry(buffer, name), new MeshStandardMaterial());
      group.add(mesh);models.push({ name, mesh });
    },
    onStart: () => { loading = true; },
    onFinish: added => { loading = false;finishes.push(added); },
    onError: message => errors.push(message),
  });
  return { group, models, upload, errors, finishes, get loading() { return loading; } };
}

test('second selection replaces the first batch and disposes its scene resources', async () => {
  const v = viewer();
  await v.upload([file('first-upper.obj'), file('first-lower.obj')]);
  const oldMeshes = [...v.group.children];
  let disposed = 0;
  for (const mesh of oldMeshes) {
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
  }
  await v.upload([file('second-upper.obj'), file('second-lower.obj')]);
  assert.deepEqual(v.models.map(m => m.name), ['second-upper.obj', 'second-lower.obj']);
  assert.equal(v.group.children.length, 2);
  assert.ok(oldMeshes.every(mesh => mesh.parent === null));
  assert.equal(disposed, 4);
  assert.deepEqual(v.finishes, [2, 2]);
  clearModels(v.group, v.models);
});

test('a late older read cannot enter the scene or end the latest loading state', async () => {
  const v = viewer(), old = deferredFile('old.obj'), latest = deferredFile('latest.obj');
  const oldUpload = v.upload([file('old-upper.obj'), old, file('old-lower.obj')]);
  await Promise.resolve();
  assert.equal(v.models.length, 1);
  const latestUpload = v.upload([latest]);
  assert.equal(v.group.children.length, 0);
  old.resolve(triangle);await oldUpload;
  assert.equal(v.group.children.length, 0);
  assert.equal(v.loading, true);
  assert.deepEqual(v.finishes, []);
  latest.resolve(triangle);await latestUpload;
  assert.deepEqual(v.models.map(m => m.name), ['latest.obj']);
  assert.equal(v.loading, false);
  assert.deepEqual(v.finishes, [1]);
  clearModels(v.group, v.models);
});

test('a stale read failure cannot show errors or overwrite a completed newer batch', async () => {
  const v = viewer(), old = deferredFile('old.obj');
  const oldUpload = v.upload([old]);
  await v.upload([file('latest.obj')]);
  old.reject(new Error('read failed'));await oldUpload;
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.finishes, [1]);
  assert.deepEqual(v.models.map(m => m.name), ['latest.obj']);
  clearModels(v.group, v.models);
});

test('canceling selection preserves current models and pending uploads', async () => {
  const v = viewer();
  await v.upload([file('current.obj')]);
  const currentMesh = v.group.children[0];
  await v.upload([]);
  assert.equal(v.group.children[0], currentMesh);
  const pending = deferredFile('pending.obj');
  const upload = v.upload([pending]);
  await v.upload([]);
  pending.resolve(triangle);await upload;
  assert.deepEqual(v.models.map(m => m.name), ['pending.obj']);
  clearModels(v.group, v.models);
});

test('invalid files do not restore old models and valid files in the same batch still load', async () => {
  const v = viewer();
  await v.upload([file('previous.obj')]);
  await v.upload([file('invalid.txt'), { ...file('large.obj'), size: 151 * 1024 * 1024 },
    { ...file('broken.obj'), arrayBuffer: async () => new ArrayBuffer(0) }, file('valid.obj')]);
  assert.equal(v.errors.length, 3);
  assert.deepEqual(v.models.map(m => m.name), ['valid.obj']);
  await v.upload([file('invalid.txt')]);
  assert.equal(v.group.children.length, 0);
  assert.equal(v.models.length, 0);
  assert.equal(v.loading, false);
  assert.deepEqual(v.finishes, [1, 1, 0]);
});
