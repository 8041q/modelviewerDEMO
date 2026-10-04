# Add models here

Start `npm run serve` once and leave it running. Drop self-contained `.glb` files directly into this folder. The server waits for a stable file, prepares a copy in `optimized/`, and appends it to `hotspot.json`. New entries appear automatically in open viewers; no import command or refresh is needed. Files already here are imported at startup. Changes to existing JSON entries also reach open viewers automatically.

For static hosting, run `npm run models:import` before deploying. Deploy `hotspot.json` and `models/optimized/` alongside the viewer. Original GLBs are never changed. Keep `import-manifest.json` with your project so future imports retain their model keys and settings.

The generic pipeline preserves all triangles. It deduplicates materials, joins eligible static meshes, and uses Draco compression. It preserves animated hierarchies and texture bytes. Skins, morph targets, instanced meshes, and unknown extensions use an unchanged copy. Unsupported extensions may still require support in the pinned viewer; automatic import cannot add renderer capabilities.

Surface hotspots refer to mesh vertices. Once you add them, the importer keeps that prepared asset untouched. Changing its source pauses the update with a diagnostic; remove the anchors before rebuilding, then remap them against the new prepared mesh. This avoids silently invalidating anchors authored against a previously optimized copy.

No custom controller layout is required: embedded animations get playback buttons automatically. Existing controller layouts and hotspots remain configurable in `hotspot.json`. Removing a source file does not remove its model entry or renumber existing links. To remove a model permanently, edit `hotspot.json` deliberately; later numeric links will shift.

Use descriptive, unique filenames. Replacing the same filename updates its existing model entry; new content gets a new URL to avoid stale asset caches. Import reports are stored in `import-manifest.json`. Outputs from earlier revisions are retained, so existing cached pages can finish using them.
