import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sameArray = (a, b, tolerance = 0) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const nodesIn = node => { const nodes = []; node.traverse(n => nodes.push(n)); return nodes; };

export function animationSnapshot(document) {
  return document.getRoot().listAnimations().map(animation => ({
    name: animation.getName(),
    channels: animation.listChannels().map(channel => {
      const sampler = channel.getSampler();
      return { target: channel.getTargetNode().getName(), matrix: channel.getTargetNode().getWorldMatrix(), path: channel.getTargetPath(), interpolation: sampler.getInterpolation(), input: hash(sampler.getInput().getArray()), output: hash(sampler.getOutput().getArray()) };
    }),
  }));
}

export function textureSnapshot(document) {
  return document.getRoot().listTextures().map(texture => ({ mimeType: texture.getMimeType(), image: hash(texture.getImage()) }));
}

export function assertAnimationsPreserved(expected, document) {
  const actual = animationSnapshot(document);
  assert.equal(actual.length, expected.length, 'Animation count changed');
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].name, expected[i].name);
    assert.equal(actual[i].channels.length, expected[i].channels.length);
    for (let c = 0; c < expected[i].channels.length; c++) {
      const before = expected[i].channels[c], after = actual[i].channels[c];
      assert.ok(sameArray(before.matrix, after.matrix, 1e-6), 'Animated group world transform changed');
      assert.deepEqual({ ...after, matrix: undefined }, { ...before, matrix: undefined }, 'Animation sampler data changed');
    }
  }
}

// This is a guarded repair for this bed, not a rule that shared meshes are redundant.
// Reused mesh data is valid; removal requires identical placement and animation.
export function removeDuplicateBed(document) {
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const candidates = scene.listChildren().filter(node => node.getName() === '组099');
  assert.equal(candidates.length, 1, 'Expected the known duplicate bed root');
  const duplicate = candidates[0];
  const removedNodes = new Set(nodesIn(duplicate));
  const retainedNodes = root.listNodes().filter(node => !removedNodes.has(node));
  const meshNodes = [...removedNodes].filter(node => node.getMesh());
  assert.equal(meshNodes.length, 929, 'Source bed structure changed; re-audit duplicate removal');
  for (const node of meshNodes) {
    assert.ok(retainedNodes.some(other => other.getMesh() === node.getMesh() && sameArray(other.getWorldMatrix(), node.getWorldMatrix(), 1e-8)), `No matching retained mesh for ${node.getName()}`);
  }
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (!removedNodes.has(channel.getTargetNode())) continue;
      const sampler = channel.getSampler();
      const match = animation.listChannels().find(other => !removedNodes.has(other.getTargetNode()) && other.getTargetPath() === channel.getTargetPath() && other.getTargetNode().getName() === channel.getTargetNode().getName() && sameArray(other.getTargetNode().getWorldMatrix(), channel.getTargetNode().getWorldMatrix(), 1e-8) && other.getSampler().getInterpolation() === sampler.getInterpolation() && sameArray(other.getSampler().getInput().getArray(), sampler.getInput().getArray()) && sameArray(other.getSampler().getOutput().getArray(), sampler.getOutput().getArray()));
      assert.ok(match, 'Duplicate animation does not match retained animation');
      channel.dispose();
    }
  }
  scene.removeChild(duplicate);
  for (const node of removedNodes) node.dispose();
  return { meshNodesRemoved: meshNodes.length, nodesRemoved: removedNodes.size };
}
