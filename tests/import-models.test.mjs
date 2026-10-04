import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { animationSnapshot, assertAnimationsPreserved } from '../scripts/bed-asset.mjs';
import { createModelImporter, prepareGLB } from '../scripts/import-models.mjs';
import { startViewerServer } from '../scripts/serve.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

async function fixture({ animated = false, morph = false, scale = 1 } = {}) {
  const document = new Document(), buffer = document.createBuffer();
  const scene = document.createScene('Scene');
  document.getRoot().setDefaultScene(scene);
  const positions = [], indices = [], width = 30;
  for (let y = 0; y <= width; y++) for (let x = 0; x <= width; x++) positions.push(x / width * scale, y / width * scale, Math.sin(x / width * Math.PI) * 0.1);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const a = y * (width + 1) + x, b = a + width + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const mesh = name => {
    const primitive = document.createPrimitive().setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
      .setMaterial(document.createMaterial().setBaseColorFactor([0.2, 0.5, 0.8, 1]));
    if (morph) primitive.addTarget(document.createPrimitiveTarget().setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions.length)).setBuffer(buffer)));
    return document.createMesh(name).addPrimitive(primitive);
  };
  const firstMesh = mesh('First mesh');
  const first = document.createNode('Moving').setMesh(firstMesh);
  scene.addChild(first);
  // Shared meshes at different placements are legitimate, including animated instances.
  scene.addChild(document.createNode('Stationary').setMesh(animated ? firstMesh : mesh('Second mesh')).setTranslation([2, 0, 0]));
  if (animated) for (const [name, end] of [['Open', 1], ['Close', -1]]) {
    const sampler = document.createAnimationSampler().setInterpolation('LINEAR').setInput(document.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer))
      .setOutput(document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, end, 0, 0])).setBuffer(buffer));
    document.createAnimation(name).addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(first).setTargetPath('translation').setSampler(sampler));
  }
  return { document, bytes: Buffer.from(await io.writeBinary(document)) };
}

async function workspace(t) {
  const parent = path.resolve('.performance');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'import-test-'));
  const beforeCleanup = [];
  assert.ok(root.startsWith(parent + path.sep));
  t.after(async () => {
    for (const close of beforeCleanup) await close();
    assert.ok(path.resolve(root).startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'hotspot.json'), JSON.stringify({ models: { original: { file: 'first.glb' }, second: { file: 'second.glb' } } }));
  await mkdir(path.join(root, 'models'));
  const messages = [];
  const importer = await createModelImporter(root, { log: message => messages.push(message) });
  const config = async () => JSON.parse(await readFile(path.join(root, 'hotspot.json'), 'utf8'));
  return { root, importer, messages, config, beforeCleanup, source: name => path.join(root, 'models', name) };
}

test('generic preparation reduces static mesh overhead without deleting triangles', async () => {
  const source = await fixture();
  const result = await prepareGLB(source.bytes);
  assert.equal(result.mode, 'static-joined-draco', result.reason);
  assert.equal(result.before.primitives, 2);
  assert.equal(result.after.primitives, 1);
  assert.equal(result.before.triangles, 3600);
  assert.equal(result.after.triangles, 3600);
  assert.ok(result.bytes.length < source.bytes.length);
});

test('animated mesh reuse and both named clips survive preparation', async () => {
  const source = await fixture({ animated: true });
  const result = await prepareGLB(source.bytes);
  assert.equal(result.mode, 'draco', result.reason);
  const decoded = await io.readBinary(result.bytes);
  assertAnimationsPreserved(animationSnapshot(source.document), decoded);
  assert.deepEqual(decoded.getRoot().listAnimations().map(a => a.getName()), ['Open', 'Close']);
  assert.equal(decoded.getRoot().listNodes().length, 2);
  assert.equal(result.after.primitives, 2);
  assert.equal(result.after.triangles, 3600);
});

test('morphs and surface-anchored geometry retain exact source bytes', async () => {
  const source = await fixture({ morph: true });
  const morph = await prepareGLB(source.bytes);
  assert.equal(morph.mode, 'original');
  assert.deepEqual(morph.bytes, source.bytes);
  const anchored = await prepareGLB((await fixture()).bytes, { preserveSurfaces: true });
  assert.equal(anchored.mode, 'original');
  assert.match(anchored.reason, /Surface anchors/);
});

test('imports append numeric links, remain idempotent, and preserve customized metadata on replacement', async t => {
  const w = await workspace(t), source = await fixture({ animated: true });
  await writeFile(w.source('123.glb'), source.bytes);
  assert.deepEqual((await w.importer.scan()).errors, []);
  const firstConfig = await w.config(), keys = Object.keys(firstConfig.models), key = keys[2];
  assert.deepEqual(keys.slice(0, 2), ['original', 'second']);
  assert.match(key, /^model-123-/);
  const output = firstConfig.models[key].file;
  assert.deepEqual(await readFile(w.source('123.glb')), source.bytes);
  const configTime = (await stat(path.join(w.root, 'hotspot.json'))).mtimeMs;
  await w.importer.scan();
  assert.equal((await stat(path.join(w.root, 'hotspot.json'))).mtimeMs, configTime);
  firstConfig.models[key].displayName = 'My custom name';
  firstConfig.models[key].controller = { image: 'remote.png', buttons: [{ label: 'Open', animation: 'Open' }] };
  await writeFile(path.join(w.root, 'hotspot.json'), JSON.stringify(firstConfig));
  await writeFile(w.source('123.glb'), (await fixture({ animated: true, scale: 2 })).bytes);
  await w.importer.scan();
  const updated = await w.config();
  assert.deepEqual(Object.keys(updated.models), keys);
  assert.equal(updated.models[key].displayName, 'My custom name');
  assert.deepEqual(updated.models[key].controller, firstConfig.models[key].controller);
  assert.notEqual(updated.models[key].file, output);
  assert.ok(await stat(path.join(w.root, output))); // Old URLs remain available.
  await unlink(path.join(w.root, updated.models[key].file));
  await w.importer.scan();
  assert.ok(await stat(path.join(w.root, updated.models[key].file))); // Missing prepared copy is rebuilt.
  await unlink(w.source('123.glb'));
  await w.importer.scan();
  assert.deepEqual(Object.keys((await w.config()).models), keys);
});

test('partial files fail independently and recover after replacement', async t => {
  const w = await workspace(t), source = await fixture();
  await writeFile(w.source('broken.glb'), source.bytes.subarray(0, 30));
  await writeFile(w.source('valid.GLB'), source.bytes);
  const result = await w.importer.scan();
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0][0], 'broken.glb');
  assert.equal(Object.keys((await w.config()).models).length, 3);
  await writeFile(w.source('broken.glb'), source.bytes);
  assert.deepEqual((await w.importer.scan()).errors, []);
  assert.equal(Object.keys((await w.config()).models).length, 4);
});

test('watcher imports a new drop automatically after the file settles', async t => {
  const w = await workspace(t), source = await fixture();
  await w.importer.scan();
  const stop = w.importer.watch();
  w.beforeCleanup.push(stop);
  await writeFile(w.source('New Chair.glb'), source.bytes);
  const deadline = Date.now() + 9000;
  while (Object.keys((await w.config()).models).length < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(Object.keys((await w.config()).models).length, 3);
  await stop();
});

test('simultaneous importers serialize configuration updates', async t => {
  const w = await workspace(t), source = await fixture();
  const other = await createModelImporter(w.root, { log: () => {} });
  await writeFile(w.source('Chair.glb'), source.bytes);
  const results = await Promise.all([w.importer.scan(), other.scan()]);
  assert.equal(results.filter(result => result.busy).length, 1);
  await writeFile(w.source('Table.glb'), source.bytes);
  await other.scan();
  const config = await w.config();
  assert.equal(Object.keys(config.models).length, 4);
  const manifest = JSON.parse(await readFile(path.join(w.root, 'models/import-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.records).sort(), ['Chair.glb', 'Table.glb']);
});

test('adding surface anchors freezes the current prepared mesh until anchors are cleared', async t => {
  const w = await workspace(t), source = await fixture();
  await writeFile(w.source('Anchored.glb'), source.bytes);
  await w.importer.scan();
  const config = await w.config(), key = Object.keys(config.models)[2], output = config.models[key].file;
  const preparedBytes = await readFile(path.join(w.root, output));
  config.models[key].hotspots = [{ surface: '0 0 0 1 2 0.333 0.333 0.334', label: 'Anchor' }];
  await writeFile(path.join(w.root, 'hotspot.json'), JSON.stringify(config));
  assert.deepEqual((await w.importer.scan()).errors, []);
  assert.equal((await w.config()).models[key].file, output);
  assert.deepEqual(await readFile(path.join(w.root, output)), preparedBytes);
  await writeFile(w.source('Anchored.glb'), (await fixture({ scale: 2 })).bytes);
  assert.match((await w.importer.scan()).errors[0][1], /surface hotspots/);
  assert.equal((await w.config()).models[key].file, output);
  config.models[key].hotspots = [];
  await writeFile(path.join(w.root, 'hotspot.json'), JSON.stringify(config));
  assert.deepEqual((await w.importer.scan()).errors, []);
  assert.notEqual((await w.config()).models[key].file, output);
});

test('local server imports drops and notifies connected viewers automatically', async t => {
  const w = await workspace(t), source = await fixture();
  await writeFile(path.join(w.root, 'index.html'), '<html><head></head><body>Viewer</body></html>');
  const app = await startViewerServer({ root: w.root, port: 0 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  w.beforeCleanup.push(async () => { clearTimeout(timeout); controller.abort(); await app.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await fetch(`${base}/index.html`).then(response => response.text());
  assert.match(page, /scripts\/live-models\.js/);
  assert.doesNotMatch(await readFile(path.join(w.root, 'index.html'), 'utf8'), /live-models/);
  const response = await fetch(`${base}/__models/events`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const initial = decoder.decode((await reader.read()).value);
  assert.match(initial, /event: models-changed/);
  await writeFile(w.source('Automatic.glb'), source.bytes);
  const next = decoder.decode((await reader.read()).value);
  assert.match(next, /event: models-changed/);
  assert.notEqual(next, initial);
  assert.equal(Object.keys((await w.config()).models).length, 3);
});
