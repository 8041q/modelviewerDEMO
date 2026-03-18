# Model Viewer Demo

A minimal web-based 3D model viewer demo. Open `index.html` in a browser (or serve the folder over HTTP) to view the scene and hotspots defined in `hotspot.json`.

## Quick start

- Double-click `index.html` to open in your default browser.
- Or run a local HTTP server (recommended) from the project root:

```bash
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

## What this is

A tiny demo that loads 3D models and displays interactive hotspots. The viewer code is in `viewer.js` and styles are in `style.css`.

## License & proprietary models

- Source code: MIT License (see LICENSE).
- 3D model assets: Proprietary, restricted license (see LICENSE-ASSETS) (for example `.glb`, `.gltf`, `.fbx`).

## Files of interest

- `index.html` — page entry
- `viewer.js` — viewer logic
- `hotspot.json` — scene/hotspot definitions (references model files)
- `style.css` — styling

## Usage URLs

The viewer supports two URL controls:
- Query parameter `hideUI=true` or `hideUI=false` to hide/show the viewer controls.
- Hash `#<index>` to open a specific model by numeric index (0-based) matching the order in `hotspot.json`.

### Examples

- empty — default: shows UI and loads the first model.
- `#0` — loads model index 0 (first model) and shows UI.
- `?hideUI=true#0` — loads model index 0 and hides the UI controls.
- `?hideUI=false#1` — loads model index 1 and shows the UI controls.

### Current model index mapping (from `hotspot.json`)

- `#0` — Z7z Bed
- `#1` — Headboard

---

## GLB Compression (DRACO + KTX2)

Models are compressed using `@gltf-transform/cli` for faster load times. This is a one-time CLI step per file — `<model-viewer>` handles decompression automatically via its built-in decoders, so no code changes are needed.

### Results

| Model | Original | Compressed |
|-------|----------|------------|
| Z7z Bed | ~87 MB | ~15 MB |
| Headboard | ~1 MB | ~KB range |

### Prerequisites

```bash
npm install --global @gltf-transform/cli
```

KTX2 texture compression also requires the `ktx` binary from KTX-Software 4.3.0+:
- **macOS:** `brew install ktx-software`
- **Windows/Linux:** download from https://github.com/KhronosGroup/KTX-Software/releases and add the `bin` folder to your PATH.

On Windows (PowerShell), add it for the current session with:

```powershell
$env:Path += ";C:\Program Files\KTX-Software\bin"
```

### Compression pipeline

#### Simple models (no instancing, no animations)

```bash
gltf-transform optimize model.glb model-comp.glb --compress draco --texture-compress ktx2
```

#### Complex models with instancing

Instanced meshes are skipped by DRACO unless flattened first. Use `join` to bake instances, then compress geometry and textures separately:

```bash
gltf-transform join model.glb model-tmp1.glb
gltf-transform prune model-tmp1.glb model-tmp2.glb --keep-attributes false
gltf-transform draco model-tmp2.glb model-comp.glb
del model-tmp1.glb model-tmp2.glb
```

Notes:
- `join` bakes out all mesh instances so DRACO can compress them. It will temporarily increase file size before DRACO brings it back down.
- `prune --keep-attributes false` strips unused vertex attributes and animation data.
- Texture compression (`etc1s` / `uastc`) is skipped here — running it after DRACO decodes geometry and re-encodes, which can increase file size. Test before committing to that step.
- If you want to attempt texture compression, do it as a final step and verify the output size: `gltf-transform uastc model-comp.glb model-comp-tex.glb --level 2`

### Enabling decoders in `<model-viewer>`

When serving compressed GLBs, explicitly set the decoder paths on the `<model-viewer>` element to ensure KTX2 textures render correctly across all browsers:

```html
<model-viewer
  ...
  ktx2-transcoder-path="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/decoders/"
  draco-decoder-path="https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
></model-viewer>
```

Also pin the model-viewer script to a specific version to prevent regressions:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js"></script>
```

### Troubleshooting

**`etc1s` or `uastc` increases file size** — this happens when texture compression runs after DRACO, because gltf-transform must decode the geometry first. Skip texture compression or run it before the DRACO step.

**`error: Unknown command deinstance`** — use `gltf-transform join` instead, which flattens instances as a side effect.

**`error: Command "ktx" not found`** — KTX-Software is not on your PATH. If already installed, do set $env:Path as above indicated
