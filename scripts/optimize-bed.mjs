import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, draco, flatten, join, prune, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import { animationSnapshot, assertAnimationsPreserved, removeDuplicateBed, textureSnapshot } from './bed-asset.mjs';
import { inspectGLB } from './inspect-glb.mjs';

await mkdir('.performance', { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
// Start from the lossless source, never from a previous compressed output.
const document = await io.read('assets-original/Z7z.glb');
const textures = textureSnapshot(document);
const removed = removeDuplicateBed(document);
await document.transform(prune({ keepAttributes: true, keepSolidTextures: true }));
const animations = animationSnapshot(document);

const cleaned = cloneDocument(document);
await cleaned.transform(draco());
await io.write('.performance/Z7z-cleaned.glb', cleaned);

await document.transform(
  dedup({ propertyTypes: [PropertyType.MATERIAL] }),
  flatten(),
  join({ keepNamed: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
  prune({ keepAttributes: true, keepSolidTextures: true }),
);
assertAnimationsPreserved(animations, document);
assert.deepEqual(textureSnapshot(document), textures, 'JPEG texture changed');
await document.transform(draco());
await io.write('Z7z-optimized.glb', document);

const decoded = await io.read('Z7z-optimized.glb');
assertAnimationsPreserved(animations, decoded);
assert.deepEqual(textureSnapshot(decoded), textures);
const report = {
  removed,
  settings: { ratio: 0.5, error: 0.001, compression: 'Draco', source: 'assets-original/Z7z.glb' },
  baseline: inspectGLB('Z7z-comp.glb'),
  cleaned: inspectGLB('.performance/Z7z-cleaned.glb'),
  optimized: inspectGLB('Z7z-optimized.glb'),
};
await writeFile('.performance/asset-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
