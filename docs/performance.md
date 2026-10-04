# Performance verification

Measured on 2026-10-04 using the Codex in-app desktop browser and a local HTTP server. The production page continues to use model-viewer 4.0.0.

## Asset changes

| Metric | Previous bed | Optimized bed | Reduction |
|---|---:|---:|---:|
| GLB bytes | 10,371,068 | 8,303,700 | 19.9% |
| Rendered scene triangles | 3,474,622 | 1,496,918 | 56.9% |
| Mesh primitive instances | 1,886 | 34 | 98.2% |
| Mesh nodes | 1,860 | 29 | 98.4% |
| Materials | 46 | 25 | 45.7% |

Primitive instances are an indicator of draw-call overhead, not measured GPU draw calls. Shadow and other render passes can add calls.

The duplicated branch contained 929 meshes with the same geometry references, world transforms, and animation sampler data as the retained branch. Removing it left 1,737,535 triangles before simplification. Joining and simplification brought that to 1,496,918. The 0.001 error constraint prevented reaching the requested 50% simplification ratio; the build retains that limit rather than sacrificing more detail.

Both original clip names, durations, retained samplers, and animated world transforms were checked against the lossless source. Each clip now has three channels instead of six because the redundant targets were removed. The 91,735-byte JPEG is byte-identical. Original source assets and the previous compressed output were retained.

## Browser measurements

The benchmark iframe was 1265 × 720 CSS pixels at device pixel ratio 1. Both versions used the same lighting and original camera orbit, `45deg 55deg 4m`. Production framing now uses a relative camera distance so the bed also fits portrait embeds; the development measurement hook fixes the original camera explicitly for comparisons.

| Sample | Previous viewer/asset | Optimized viewer/asset |
|---|---:|---:|
| Cold GLB load to `load` event | 847.1 ms | 711.5 ms |
| Cached GLB load to `load` event | 938.5 ms | 683.5 ms |
| Cold-run median / p95 animation-frame interval | 31.2 / 31.8 ms | 31.3 / 31.8 ms |
| Cached-run median / p95 animation-frame interval | 31.3 / 31.9 ms | 31.3 / 31.8 ms |

These are individual local samples, not a statistically established speedup. Runtime and decoder caches were warm; cold GLB samples used unique asset URLs and transferred the whole file. Cached samples reported zero transfer bytes. Timing includes initialization and first rendering, not just file transfer. The cached baseline sample being slower than the cold sample illustrates run-to-run variation.

Five seconds of rotation were sampled using `requestAnimationFrame`. This measures main-thread frame cadence, not GPU execution or the number of rendered frames. The approximately 31 ms cadence was essentially unchanged, and the optimized cached run included one 62.5 ms interval. There is no demonstrated FPS improvement in this browser from these measurements. The geometry and primitive reductions remain independently verified.

Raw local measurements, intermediate assets, baseline snapshots, and comparison screenshots are in `.performance/` (ignored development output). Use the browser comparison page documented in the README to repeat measurements on a target device.

## Functional and visual checks

- Twelve Node tests pass: bed geometry/animation/texture/bounds validation, duplicate-repair guards and numeric mapping, plus generic static preparation, animated mesh reuse, morph/anchor preservation, idempotent imports and replacements, partial-file recovery, watched drops, concurrent imports, and live server notifications after automatic preparation.
- Ten browser regression groups pass on desktop and at a 390 × 844 desktop viewport (375-pixel iframe width): registration/default URLs, duplicate selection/invalid indices, cached model switching, rapid switching/progress cleanup, animation restart/completion/cancellation, hidden controls/restoration, missing assets/recovery, retrying an identical asset URL after a transient failure, imported-model selection with automatically discovered animation controls, and live configuration updates that preserve the current pose and handle aliases, replacements, and invalid JSON.
- A temporary GLB was dropped into the running project's `models/` folder. It appeared in an already open viewer without an import command or page refresh, and selecting it rendered successfully. The temporary source, prepared copy, manifest record, and JSON entry were removed after verification.
- Starting views and both clips at midpoint/end were visually compared at the original camera. No visible silhouette, material, or moving-part alignment regression was observed at that view.
- The standalone portrait layout was checked at 390 × 844. Relative camera framing fixed the clipping caused by the original fixed 4 m camera distance.

No physical phone was connected for this run. Phone-sized desktop checks establish responsive layout and functional behavior; physical-phone load time, GPU smoothness, and memory use remain unverified.
