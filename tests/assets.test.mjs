import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { animationSnapshot, assertAnimationsPreserved, removeDuplicateBed, textureSnapshot } from '../scripts/bed-asset.mjs';
import { inspectGLB } from '../scripts/inspect-glb.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

test('optimized asset preserves animations, texture, bounds, and valid geometry', async () => {
  const source = await io.read('assets-original/Z7z.glb');
  const originalTextures = textureSnapshot(source);
  const removed = removeDuplicateBed(source);
  assert.equal(removed.meshNodesRemoved, 929);
  await source.transform(prune({ keepAttributes: true, keepSolidTextures: true }));
  const optimized = await io.read('Z7z-optimized.glb');
  assertAnimationsPreserved(animationSnapshot(source), optimized);
  assert.deepEqual(textureSnapshot(optimized), originalTextures);
  const sourceBounds = getBounds(source.getRoot().getDefaultScene());
  const optimizedBounds = getBounds(optimized.getRoot().getDefaultScene());
  for (const bound of ['min', 'max']) for (let i = 0; i < 3; i++) assert.ok(Math.abs(sourceBounds[bound][i] - optimizedBounds[bound][i]) < 0.005, 'Bounds moved by more than 5 mm');
  for (const mesh of optimized.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      assert.ok(positions);
      for (const accessor of primitive.listAttributes()) {
        assert.equal(accessor.getCount(), positions.getCount());
        assert.ok(accessor.getArray().every(Number.isFinite), 'Nonfinite vertex data');
      }
      const indices = primitive.getIndices();
      assert.equal(indices.getCount() % 3, 0);
      assert.ok(indices.getArray().every(index => index < positions.getCount()), 'Invalid triangle index');
    }
  }
  const before = inspectGLB('Z7z-comp.glb'), after = inspectGLB('Z7z-optimized.glb');
  assert.ok(after.triangles < before.triangles / 2);
  assert.ok(after.primitiveInstances < before.primitiveInstances / 10);
  assert.ok(after.bytes < before.bytes);
  assert.deepEqual(after.animations.map(a => a.name), before.animations.map(a => a.name));
  assert.ok(after.extensions.includes('KHR_draco_mesh_compression'));
  assert.equal(after.textures[0].mimeType, 'image/jpeg');
});

test('duplicate repair refuses a bed copy with a different placement', async () => {
  const source = await io.read('assets-original/Z7z.glb');
  const duplicate = source.getRoot().getDefaultScene().listChildren().find(node => node.getName() === '组099');
  const translation = duplicate.getTranslation();
  duplicate.setTranslation([translation[0] + 0.01, translation[1], translation[2]]);
  assert.throws(() => removeDuplicateBed(source), /No matching retained mesh/);
});

test('production config selects the optimized bed and keeps numeric order', async () => {
  const config = JSON.parse(await readFile('hotspot.json', 'utf8'));
  assert.deepEqual(Object.keys(config.models).slice(0, 2), ['Z7z', 'headboard']);
  assert.equal(config.models.Z7z.file, 'Z7z-optimized.glb');
  assert.equal(config.models.headboard.file, 'headboard-comp.glb');
});
