# Model Viewer Demo

A standalone 3D viewer for iframe embedding, using `@google/model-viewer@4.0.0`. Models, hotspots, and image controllers are configured in `hotspot.json`.

## Run locally

```sh
npm ci
npm run serve
```

Open http://127.0.0.1:8080. Production hosting only needs the static viewer files and referenced assets; Node and the asset tools are development dependencies. Serve over HTTP or HTTPS: fetching JSON and loading ES modules does not reliably work through `file://`.

## Add more GLB models automatically

Run `npm run serve` once, then drop self-contained `.glb` files into `models/`. Files already there are imported at startup. The server waits for copying to settle, prepares a separate copy in `models/optimized/`, and appends it to `hotspot.json`. Open viewers receive the updated model list automatically, usually within a few seconds after preparation finishes. Choose the new entry from the Model selector; no import command or page refresh is needed. Embedded animations get playback buttons automatically.

Manual changes to `hotspot.json` also update open viewers. Adding entries preserves the selected model, camera, and animation pose. Replacing the selected model's file loads the replacement. Invalid configuration updates leave the working model list intact. Live notifications are added by the local server; the standalone page remains usable on static hosts without a persistent connection.

The import command is only needed when preparing a static deployment without the running local server:

```sh
npm run models:import
```

Deploy the static viewer, updated `hotspot.json`, and referenced optimized assets. Static hosting cannot watch a local folder or prepare models at runtime. The importer is an asset preparation tool; visitors need no Node runtime.

Replacing a source with the same filename updates its existing entry and keeps its numeric URL. Outputs use content-based filenames to avoid stale GLB caches. Originals, existing display names, hotspots, and custom controllers are preserved. Invalid or partially copied files are retried on later scans; one failed model does not block others. Removing a source does not automatically remove its configuration entry.

Generic preparation deduplicates materials, joins eligible static meshes, and compresses with Draco. It preserves triangles, animated hierarchies, and texture bytes. Reused meshes retain their hierarchy; skin, morph, instancing, and unknown-extension assets use unchanged copies. If preparation cannot preserve the data or provides no size/draw-call benefit, the original copy is used. Models with configured surface hotspots keep their current prepared asset; source changes wait until those anchors are removed or remapped. Reports live in `models/import-manifest.json`. Lossy simplification and duplicate-branch removal remain specific to the audited bed. See [models/README.md](models/README.md) for details.

## Embed in another project

```html
<iframe
  src="https://your-host/viewer/index.html?hideUI=false#0"
  title="3D model viewer"
  style="width:100%;height:600px;border:0"
></iframe>
```

- `hideUI=false`: show model selection, animation controls, the controller panel, and model hotspots.
- `hideUI=true`: hide those controls and avoid downloading the controller image.
- `#0`: Z7z Bed; `#1`: Headboard. Indices follow the order in `hotspot.json`.
- Missing URL controls default to `?hideUI=false#0`; invalid model indices fall back to `#0`.
- Model load failures display a Retry button. It reloads only this viewer document, preserving its URL and model source, because the pinned library caches failed loads. Selecting another valid model also recovers.
- Controller and hotspot animations play once, stop at their last frame, and restart when clicked again.
- The initial camera distance fits the model automatically for landscape and portrait embeds.

Keep the existing `models` JSON shape when adding assets: `file`, optional `displayName`, optional `hotspots`, and optional `controller` with an `image` and `buttons`. Each button or hotspot names a clip exported in the GLB. Controls referencing unavailable clips are disabled.

Surface hotspots encode mesh/vertex references. Joining or simplifying a model changes those references; regenerate its surface anchors after optimization. The supplied models have no surface hotspots.

## Asset preparation

```sh
npm run assets:build
npm run assets:inspect
npm test
```

The bed build always starts from `assets-original/Z7z.glb` and writes `Z7z-optimized.glb`, which the viewer now loads. The original and previous compressed GLBs are retained.

The build verifies and removes the redundant bed branch, retaining its matching animated groups and the unique headboard-holder geometry. It then deduplicates materials, flattens static hierarchy, joins compatible meshes without crossing animation boundaries, and simplifies geometry with a target ratio of 0.5 and an error limit of 0.001. The error limit takes precedence over reaching the target ratio. Draco compression runs last; the original JPEG bytes are retained.

Duplicate removal is a guarded repair for this particular bed. It requires 929 matching mesh nodes, identical world placement, and matching animation samplers; it refuses changed source structure. Do not use branch removal as a general-purpose optimization for other models.

The intermediate duplicate-only asset and asset report are written to `.performance/`. That folder is ignored by Git. The general importer uses a more conservative pipeline for future models. The bed's single 91.7 KB JPEG does not warrant a KTX2 pipeline.

## Decoders and rendering

The pinned library is imported by `viewer.js`, and initialization waits for custom-element registration before assigning `src`. Model-viewer loads its default Draco decoder on demand and handles adaptive rendering resolution automatically.

Decoder locations are JavaScript constructor configuration, not HTML attributes. To override a decoder, configure the registered constructor before assigning any model source:

```js
const ModelViewerElement = customElements.get('model-viewer');
ModelViewerElement.dracoDecoderLocation = 'https://your-host/draco/';
ModelViewerElement.ktx2TranscoderLocation = 'https://your-host/basis/';
```

See the [official loading and decoder documentation](https://modelviewer.dev/examples/loading/). Default decoders and the library require internet access; use those documented settings and a locally hosted library if offline operation is required.

## Browser verification

With `npm run serve` running, open http://127.0.0.1:8080/tests/browser.html.

- Choose the optimized viewer and asset to measure loading and frame cadence during rotation.
- Cold measurements use a fresh GLB URL. For a true cached measurement, click the cached-load button twice; confirm that the reported transfer bytes are zero.
- The runtime and decoder remain cached after their first use. These measurements isolate asset loading and initialization rather than simulate a fully cold browser.
- Use animation and pose controls for visual comparisons.
- Run browser regressions to check registration, cached loads, rapid switching, animation completion/restarts, hidden UI, load failures, and retrying the same URL.

A baseline viewer snapshot is needed to select the baseline variant. Before changing the viewer, copy `index.html`, `viewer.js`, `style.css`, and `hotspot.json` into `.performance/baseline/`. This implementation's snapshot is already present locally. Baseline snapshots are development artifacts, not production assets.

Measured results and limitations are recorded in [docs/performance.md](docs/performance.md). A phone-sized desktop viewport checks layout; performance on a physical phone must be measured on that device.

## License

Source code: MIT (see LICENSE). Model assets: proprietary and restricted (see LICENSE-ASSETS). Optimization does not change their license.
