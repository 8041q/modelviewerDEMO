// Injected by the local server only when explicitly measuring a viewer page.
(() => {
  const options = window.benchmarkOptions;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    if (typeof input !== 'string' || !input.endsWith('hotspot.json') || !response.ok) return response;
    const config = await response.json();
    if (window.viewerTestConfig) return new Response(JSON.stringify(window.viewerTestConfig), { headers: { 'Content-Type': 'application/json' } });
    const bed = config.models.Z7z;
    if (options.asset) bed.file = `/${options.asset}`;
    if (options.cold) bed.file += `?cold=${encodeURIComponent(options.cold)}`;
    if (options.scenario === 'retry') bed.file = `/__retry__/headboard.glb?case=${encodeURIComponent(options.testCase)}`;
    if (options.scenario === 'missing') bed.file = '/__missing-model__.glb';
    if (options.scenario === 'hotspots') bed.hotspots = [{ label: 'Test animation hotspot', animation: 'Action', surface: '0 0 0 1 2 0.333 0.333 0.334' }];
    if (options.scenario === 'generic') config.models.generic = { file: 'Z7z-optimized.glb', displayName: 'Imported model', hotspots: [] };
    return new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } });
  };
  const post = result => parent.postMessage({ type: 'viewer-measurement', result }, location.origin);
  const attach = () => {
    const viewer = document.getElementById('viewer');
    if (!viewer) return false;
    window.viewerTestEvents = { loads: [], errors: 0, finishes: 0 };
    viewer.addEventListener('load', event => window.viewerTestEvents.loads.push(event.detail?.url || viewer.src));
    viewer.addEventListener('error', () => window.viewerTestEvents.errors++);
    viewer.addEventListener('finished', () => window.viewerTestEvents.finishes++);
    if (!options.measure) return true;
    // Keep before/after performance and pose comparisons at the original camera.
    viewer.setAttribute('camera-orbit', '45deg 55deg 4m');
    viewer.addEventListener('error', event => post({ error: event.detail?.type || 'model error' }), { once: true });
    viewer.addEventListener('load', async () => {
      const loadMs = performance.now();
      await viewer.updateComplete;
      const deltas = [];
      const scales = [];
      viewer.addEventListener('render-scale', event => scales.push(event.detail));
      viewer.autoRotateDelay = 0;
      viewer.rotationPerSecond = '30deg';
      viewer.autoRotate = true;
      let previous;
      const start = performance.now();
      const sample = time => {
        if (previous !== undefined) deltas.push(time - previous);
        previous = time;
        if (time - start < 5000) { requestAnimationFrame(sample); return; }
        viewer.autoRotate = false;
        viewer.resetTurntableRotation();
        const sorted = [...deltas].sort((a, b) => a - b);
        const quantile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        post({ asset: viewer.src, loadMs, frameSamples: deltas.length, medianFrameMs: quantile(0.5), p95FrameMs: quantile(0.95), maxFrameMs: Math.max(...deltas), viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, renderScales: scales, resources: performance.getEntriesByType('resource').filter(entry => /\.glb/.test(entry.name)).map(entry => ({ name: entry.name, durationMs: entry.duration, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize })) });
      };
      requestAnimationFrame(sample);
    }, { once: true });
    return true;
  };
  // Cached models may load before DOMContentLoaded, so attach as soon as parsed.
  const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
  if (!attach()) observer.observe(document.documentElement, { childList: true, subtree: true });
})();
