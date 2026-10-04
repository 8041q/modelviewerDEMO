import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function inspectGLB(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error(`Invalid GLB: ${file}`);
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const child of json.nodes[id].children || []) visit(child);
  };
  for (const node of json.scenes[json.scene || 0].nodes) visit(node);
  let meshNodes = 0, primitiveInstances = 0, triangles = 0, vertices = 0;
  for (const id of visited) {
    const node = json.nodes[id];
    if (node.mesh === undefined) continue;
    meshNodes++;
    const instances = node.extensions?.EXT_mesh_gpu_instancing;
    const count = instances ? json.accessors[Object.values(instances.attributes)[0]].count : 1;
    for (const primitive of json.meshes[node.mesh].primitives) {
      primitiveInstances++;
      const positions = json.accessors[primitive.attributes.POSITION].count;
      vertices += positions * count;
      if (primitive.mode === undefined || primitive.mode === 4) triangles += (primitive.indices === undefined ? positions : json.accessors[primitive.indices].count) / 3 * count;
    }
  }
  return { file, bytes: buffer.length, nodes: visited.size, meshNodes, primitiveInstances, triangles, vertices, materials: json.materials?.length || 0, textures: json.images?.map(image => ({ mimeType: image.mimeType, bytes: json.bufferViews[image.bufferView].byteLength })) || [], animations: json.animations?.map(animation => ({ name: animation.name, channels: animation.channels.length, duration: Math.max(...animation.samplers.map(sampler => json.accessors[sampler.input].max?.[0] || 0)) })) || [], extensions: json.extensionsUsed || [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) console.log(JSON.stringify(inspectGLB(file), null, 2));
}
