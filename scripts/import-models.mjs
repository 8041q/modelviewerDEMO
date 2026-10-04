import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, flatten, getBounds, join, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import { animationSnapshot, assertAnimationsPreserved, textureSnapshot } from './bed-asset.mjs';

const PIPELINE = 1;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let ioPromise;
async function getIO() {
  ioPromise ||= (async () => {
    await MeshoptDecoder.ready;
    return new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN))
      .registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
        'meshopt.decoder': MeshoptDecoder,
      });
  })();
  return ioPromise;
}

async function atomicWrite(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}

async function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await open(file, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => unlink(file);
    } catch (error) {
      if (handle) { await handle.close().catch(() => {}); await unlink(file).catch(() => {}); throw error; }
      if (error.code !== 'EEXIST') throw error;
      try {
        const info = await stat(file);
        if (Date.now() - info.mtimeMs < 5000) return null;
        const pid = Number(await readFile(file, 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); return null; }
          catch (failure) { if (failure.code !== 'ESRCH') return null; }
        }
        await unlink(file); // Recover a lock left by a terminated importer.
      } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    }
  }
  return null;
}

function glbJSON(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67
    || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
    || bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + bytes.readUInt32LE(12) > bytes.length) {
    throw new Error('Invalid or incomplete GLB; finish copying the file and try again.');
  }
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (json.asset?.version !== '2.0' || !json.scenes?.length) throw new Error('Expected a glTF 2.0 model with a scene.');
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri && !item.uri.startsWith('data:')) throw new Error('External resources found. Export a self-contained GLB with embedded textures.');
  }
  return json;
}

function geometryStats(document) {
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  let triangles = 0, primitives = 0;
  scene.traverse(node => {
    const instancing = node.getExtension('EXT_mesh_gpu_instancing');
    const instances = instancing?.listAttributes()[0]?.getCount() || 1;
    for (const primitive of node.getMesh()?.listPrimitives() || []) {
      primitives++;
      if (primitive.getMode() === 4) triangles += (primitive.getIndices() || primitive.getAttribute('POSITION')).getCount() / 3 * instances;
    }
  });
  return { triangles, primitives, materials: root.listMaterials().length, animations: root.listAnimations().map(a => a.getName()) };
}

function validateGeometry(document) {
  for (const accessor of document.getRoot().listAccessors()) {
    if (!accessor.getArray()?.every(Number.isFinite)) throw new Error('Invalid or nonfinite accessor data.');
  }
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    if (!positions) throw new Error('A primitive has no positions.');
    for (const attribute of primitive.listAttributes()) assert.equal(attribute.getCount(), positions.getCount(), 'Attribute count mismatch');
    const indices = primitive.getIndices();
    if (indices && !indices.getArray().every(i => Number.isInteger(i) && i >= 0 && i < positions.getCount())) throw new Error('Invalid geometry indices.');
  }
}

// Generic preparation never uses the bed's duplicate-branch repair or lossy simplification.
// Unknown extensions, skins, morphs, instancing, and anchored models retain their source bytes.
export async function prepareGLB(bytes, { preserveSurfaces = false } = {}) {
  const json = glbJSON(bytes);
  const known = new Set(ALL_EXTENSIONS.map(extension => extension.EXTENSION_NAME));
  const unknown = [...new Set([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])])].filter(name => !known.has(name));
  const complex = json.skins?.length || json.meshes?.some(mesh => mesh.primitives.some(p => p.targets?.length))
    || json.nodes?.some(node => node.extensions?.EXT_mesh_gpu_instancing);
  if (unknown.length) {
    // Reading with an incomplete extension registry would silently strip unknown data.
    return { bytes, mode: 'original', reason: `Extensions preserved: ${unknown.join(', ')}`,
      before: null, after: null };
  }
  const io = await getIO();
  const document = await io.readBinary(bytes);
  validateGeometry(document);
  const root = document.getRoot();
  const before = geometryStats(document);
  if (complex || preserveSurfaces) return { bytes, mode: 'original',
    reason: preserveSurfaces ? 'Surface anchors preserved' : 'Skin, morph, or instancing data preserved', before, after: before };
  const animations = animationSnapshot(document), textures = textureSnapshot(document);
  const bounds = root.listScenes().map(getBounds);
  // Decode incoming Meshopt buffers, then export ordinary buffers and Draco geometry.
  root.listExtensionsUsed().find(extension => extension.extensionName === 'EXT_meshopt_compression')?.dispose();
  try {
    await document.transform(dedup({ propertyTypes: [PropertyType.MATERIAL] }));
    const metadata = [root, ...root.listNodes(), ...root.listMeshes()].some(p => Object.keys(p.getExtras()).length || p.listExtensions().length);
    const reused = root.listMeshes().some(mesh => root.listNodes().filter(node => node.getMesh() === mesh).length > 1);
    const staticJoin = !root.listAnimations().length && !metadata && !reused && root.listScenes().length === 1;
    if (staticJoin) await document.transform(flatten(), join({ keepNamed: false, cleanup: false }));
    await document.transform(draco({ quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14, quantizeColor: 16, quantizeGeneric: 16 }));
    await document.transform(prune({ propertyTypes: [PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR, PropertyType.BUFFER], keepAttributes: true, keepExtras: true }));
    const prepared = Buffer.from(await io.writeBinary(document));
    const decoded = await io.readBinary(prepared);
    validateGeometry(decoded);
    assertAnimationsPreserved(animations, decoded);
    assert.deepEqual(textureSnapshot(decoded), textures, 'Texture bytes changed');
    const after = geometryStats(decoded);
    assert.equal(after.triangles, before.triangles, 'Triangle count changed');
    assert.equal(decoded.getRoot().listScenes().length, bounds.length, 'Scene count changed');
    decoded.getRoot().listScenes().forEach((scene, index) => {
      const actual = getBounds(scene), expected = bounds[index];
      const extent = Math.max(...expected.max.map((v, axis) => v - expected.min[axis]));
      const tolerance = Math.max(extent * 0.0001, 0.00001);
      for (const bound of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
        // Empty scenes have infinite bounds in both documents.
        assert.ok(actual[bound][axis] === expected[bound][axis] || Math.abs(actual[bound][axis] - expected[bound][axis]) <= tolerance, 'Bounds changed');
      }
    });
    if (prepared.length >= bytes.length && after.primitives >= before.primitives) {
      return { bytes, mode: 'original', reason: 'Prepared copy offered no size or draw-call improvement', before, after: before };
    }
    return { bytes: prepared, mode: staticJoin ? 'static-joined-draco' : 'draco', before, after };
  } catch (error) {
    // A valid source remains usable if a transform cannot safely preserve its data.
    return { bytes, mode: 'original', reason: `Preparation skipped: ${error.message}`, before, after: before };
  }
}

async function readConfig(root) {
  const config = JSON.parse(await readFile(path.join(root, 'hotspot.json'), 'utf8'));
  if (!config.models || Array.isArray(config.models) || typeof config.models !== 'object') throw new Error('Invalid hotspot.json models object');
  return config;
}

// One importer serializes scans, validates before publishing, and appends configuration entries.
export async function createModelImporter(root, { log = console.log } = {}) {
  root = path.resolve(root);
  const folder = path.join(root, 'models'), outputFolder = path.join(folder, 'optimized');
  const manifestFile = path.join(folder, 'import-manifest.json');
  await mkdir(outputFolder, { recursive: true });
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { records: {} }; }
  if (!manifest.records || typeof manifest.records !== 'object' || Array.isArray(manifest.records)) throw new Error('Invalid import manifest');
  const errors = new Map(), observations = new Map(), completed = new Map();
  let lastConfigStamp;
  let running = false;

  async function importFile(filename) {
    const source = path.join(folder, filename);
    const info = await stat(source);
    const bytes = await readFile(source);
    const afterRead = await stat(source);
    if (info.size !== afterRead.size || info.mtimeMs !== afterRead.mtimeMs || bytes.length !== info.size) throw new Error('File is still being copied; waiting for a stable file.');
    const hash = digest(bytes), stem = path.basename(filename, path.extname(filename));
    const slug = stem.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 64) || 'asset';
    const record = manifest.records[filename];
    if (record && (!/^[a-z0-9_-]+$/.test(record.key)
      || !new RegExp(`^models/optimized/${record.key}-[a-f0-9]{16}\\.glb$`).test(record.file))) throw new Error('Invalid path in import manifest');
    const key = record?.key || `model-${slug}-${digest(filename).slice(0, 8)}`;
    const config = await readConfig(root);
    const existing = Object.hasOwn(config.models, key) ? config.models[key] : null;
    if (existing && !existing.file.startsWith(`models/optimized/${key}-`)) throw new Error(`Model key ${key} is already used by a manually configured model.`);
    const preserveSurfaces = !!existing?.hotspots?.length;
    if (preserveSurfaces) {
      // Anchors may have been authored against the prepared mesh, not the original.
      // Never replace that mesh automatically, even with an unchanged source copy.
      if (!record || record.sourceHash !== hash) throw new Error('Source changed while surface hotspots are configured. Remove or remap the anchors before updating this model.');
      if (!await stat(path.join(root, record.file)).then(s => s.isFile()).catch(() => false)) throw new Error('Prepared asset with surface anchors is missing. Restore that asset or remove its anchors before rebuilding.');
      return;
    }
    const signature = `${PIPELINE}:${hash}:${preserveSurfaces}`;
    const cached = record?.signature === signature && await stat(path.join(root, record.file)).then(s => s.isFile()).catch(() => false);
    if (cached && existing?.file === record.file) return;
    let result, file;
    if (cached) { result = record; file = record.file; }
    else {
      result = await prepareGLB(bytes, { preserveSurfaces });
      // Content-addressed URLs prevent cached GLBs from hiding updates.
      file = `models/optimized/${key}-${digest(result.bytes).slice(0, 16)}.glb`;
      await atomicWrite(path.join(root, file), result.bytes);
    }
    // Re-read so manual edits made during a long import are retained.
    const latest = await readConfig(root);
    if (JSON.stringify(latest.models[key]) !== JSON.stringify(existing || undefined)) throw new Error('Configuration changed during import; will retry.');
    latest.models[key] = { displayName: stem.replace(/[_-]+/g, ' '), hotspots: [], ...existing, file };
    await atomicWrite(path.join(root, 'hotspot.json'), JSON.stringify(latest, null, 2) + '\n');
    manifest.records[filename] = { key, file, signature, sourceHash: hash, sourceBytes: bytes.length, outputBytes: cached ? record.outputBytes : result.bytes.length,
      mode: result.mode, reason: result.reason, before: result.before, after: result.after };
    await atomicWrite(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    const index = Object.keys(latest.models).indexOf(key);
    log(`[models] ${filename}: ${result.mode}, ${bytes.length} → ${manifest.records[filename].outputBytes} bytes. Open index.html?hideUI=false#${index}${result.reason ? ` (${result.reason})` : ''}`);
  }

  async function scan({ stable = false } = {}) {
    if (running) return { errors: [], busy: true };
    running = true;
    let release;
    try {
      release = await acquireLock(path.join(folder, '.import.lock'));
      if (!release) return { errors: [], busy: true };
      // Another importer may have run since this instance was created.
      try { manifest = JSON.parse(await readFile(manifestFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!manifest.records || typeof manifest.records !== 'object' || Array.isArray(manifest.records)) throw new Error('Invalid import manifest');
      const files = (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isFile() && /\.glb$/i.test(entry.name)).map(entry => entry.name).sort();
      const configStamp = (await stat(path.join(root, 'hotspot.json'))).mtimeMs;
      const configChanged = configStamp !== lastConfigStamp;
      for (const filename of errors.keys()) if (!files.includes(filename)) errors.delete(filename);
      for (const filename of files) {
        try {
          const info = await stat(path.join(folder, filename));
          const observation = `${info.size}:${info.mtimeMs}`;
          if (stable) {
            if (observations.get(filename) !== observation) { observations.set(filename, observation); continue; }
            if (!configChanged && completed.get(filename) === observation) continue;
          }
          await importFile(filename);
          observations.set(filename, observation);
          completed.set(filename, observation);
          errors.delete(filename);
        } catch (error) {
          if (errors.get(filename) !== error.message) log(`[models] ${filename}: ${error.message}`);
          errors.set(filename, error.message);
        }
      }
      lastConfigStamp = configStamp;
    } finally { try { if (release) await release(); } finally { running = false; } }
    return { errors: [...errors.entries()] };
  }
  return { scan, watch() {
    let work = Promise.resolve(), busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      work = scan({ stable: true }).catch(error => log(`[models] ${error.message}`)).finally(() => { busy = false; });
    }, 1500);
    return async () => { clearInterval(timer); await work; };
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const importer = await createModelImporter(process.cwd());
  const result = await importer.scan();
  if (result.busy) console.error('Another model import is in progress; run this command again after it finishes.');
  if (result.errors.length || result.busy) process.exitCode = 1;
}
