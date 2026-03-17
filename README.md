# Model Viewer Demo

A minimal web-based 3D model viewer demo. Open `index.html` in a browser (or serve the folder over HTTP) to view the scene and hotspots defined in `hotspot.json`.

Quick start
- Double-click `index.html` to open in your default browser.
- Or run a local HTTP server (recommended) from the project root:

```bash
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

What this is
- A tiny demo that loads 3D models and displays interactive hotspots. The viewer code is in `viewer.js` and styles are in `style.css`.

License & proprietary models
- Source code: MIT License (see LICENSE).
- 3D model assets: Proprietary, restricted license (see LICENSE-3D-MODELS)(for example `.glb`, `.gltf`, `.fbx`).

Files of interest
- `index.html` — page entry
- `viewer.js` — viewer logic
- `hotspot.json` — scene/hotspot definitions (references model files)
- `style.css` — styling

Usage URLs
- The viewer supports two URL controls:
	- Query parameter `hideUI=true` or `hideUI=false` to hide/show the viewer controls.
	- Hash `#<index>` to open a specific model by numeric index (0-based) matching the order in `hotspot.json`.

Examples
- empty — default: shows UI and loads the first model.
- `#0` — loads model index 0 (first model) and shows UI.
- `?hideUI=true#0` — loads model index 0 and hides the UI controls.
- `?hideUI=false#1` — loads model index 1 and shows the UI controls.

Current model index mapping (from `hotspot.json`)
- `#0` — Z7z Bed
- `#1` — Headboard

Enjoy — let me know if you want the README expanded or the license holder changed.

```

Next Implementation

GLB Compression (DRACO + KTX2)
Once models are finalised, run them through gltf-transform to apply DRACO geometry compression (60–90% mesh reduction) and KTX2/Basis texture compression (4–8× smaller, GPU-native). This is a one-time CLI step per file and requires no code changes — model-viewer already ships with the necessary decoders. Prioritise when any GLB exceeds 5MB, as this will be the single largest load-time improvement available.
```