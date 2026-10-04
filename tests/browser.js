const frame = document.getElementById('frame');
const results = document.getElementById('results');
const viewer = () => frame.contentDocument?.getElementById('viewer');
let currentAnimation = 'Action';
function measure(cold) {
  const variant = document.getElementById('variant').value;
  const asset = document.getElementById('asset').value;
  const params = new URLSearchParams({ hideUI: 'false', __measure: '1', __asset: asset });
  if (cold) params.set('__cold', Date.now().toString());
  results.textContent = `Measuring ${variant}, ${asset}, ${cold ? 'cold' : 'cached'}...`;
  frame.src = `${variant === 'baseline' ? '/__baseline__/' : '/'}index.html?${params}#0`;
}
document.getElementById('cold').onclick = () => measure(true);
document.getElementById('warm').onclick = () => measure(false);
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data.type !== 'viewer-measurement') return;
  results.textContent = JSON.stringify(event.data.result, null, 2);
});
for (const [id, animation] of [['headboard', 'Action'], ['nurse', 'Action.001']]) {
  document.getElementById(id).onclick = async () => {
    const v = viewer(); if (!v?.loaded) return;
    currentAnimation = animation;
    v.pause(); v.animationName = animation; v.animationCrossfadeDuration = 0;
    await v.updateComplete;
    v.currentTime = 0; v.play({ repetitions: 1 });
  };
}
for (const [id, fraction] of [['start', 0], ['mid', 0.5], ['end', 1]]) {
  document.getElementById(id).onclick = async () => {
    const v = viewer(); if (!v?.loaded) return;
    v.pause(); v.animationName = currentAnimation; v.animationCrossfadeDuration = 0;
    await v.updateComplete;
    v.currentTime = v.duration * fraction;
  };
}
document.getElementById('regression').onclick = async () => {
  const passed = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (predicate, message, timeout = 15000) => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) throw new Error(`Timed out: ${message}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const ready = () => viewer()?.loaded && viewer().getAttribute('aria-busy') === 'false';
  const events = () => frame.contentWindow.viewerTestEvents;
  const documentInFrame = () => frame.contentDocument;
  const navigate = async (query, hash = '0') => {
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.src = `/index.html?__scenario=${query}&__case=${Date.now()}#${hash}`;
    await loaded;
  };
  const finish = name => { passed.push(name); results.textContent = JSON.stringify({ passed, running: true }, null, 2); };
  document.getElementById('regression').disabled = true;
  results.textContent = 'Running browser regressions against the production viewer...';
  try {
    await navigate('normal');
    await waitFor(ready, 'initial bed');
    check(!Object.hasOwn(viewer(), 'src'), 'src shadows the registered custom element property');
    check(frame.contentWindow.location.search.includes('hideUI=false'), 'Missing default hideUI');
    check(viewer().src.endsWith('Z7z-optimized.glb'), 'Wrong initial asset');
    check(documentInFrame().querySelectorAll('.controller-btn').length === 2, 'Missing controller');
    finish('Registration, URL defaults, optimized bed, and controller');

    const initialLoads = events().loads.length;
    frame.contentWindow.dispatchEvent(new frame.contentWindow.HashChangeEvent('hashchange'));
    await new Promise(resolve => setTimeout(resolve, 150));
    check(events().loads.length === initialLoads && documentInFrame().querySelectorAll('.controller-btn').length === 2, 'Duplicate selection cleared controls or reloaded');
    frame.contentWindow.location.hash = '99';
    await waitFor(() => frame.contentWindow.location.hash === '#0', 'invalid hash normalization');
    check(events().loads.length === initialLoads, 'Invalid hash reloaded current model');
    finish('Duplicate selection and invalid index fallback');

    frame.contentWindow.location.hash = '1';
    await waitFor(() => ready() && viewer().src.endsWith('headboard-comp.glb'), 'headboard');
    check(documentInFrame().getElementById('bed-controller-panel').hidden, 'Controller carried over to headboard');
    frame.contentWindow.location.hash = '0';
    await waitFor(() => ready() && viewer().src.endsWith('Z7z-optimized.glb'), 'cached bed switch');
    check(documentInFrame().querySelectorAll('.controller-btn').length === 2, 'Cached load missed its handler');
    finish('Model switching and cached load controls');

    frame.contentWindow.location.hash = '1';
    await new Promise(resolve => setTimeout(resolve, 0));
    frame.contentWindow.location.hash = '0';
    await new Promise(resolve => setTimeout(resolve, 0));
    frame.contentWindow.location.hash = '1';
    await waitFor(() => ready() && viewer().src.endsWith('headboard-comp.glb'), 'rapid switches');
    await new Promise(resolve => setTimeout(resolve, 750));
    check(documentInFrame().querySelectorAll('.controller-btn').length === 0, 'Stale load restored bed controls');
    check(documentInFrame().getElementById('progress-container').hidden, 'Progress reset did not finish');
    finish('Rapid switching, stale loads, and progress cleanup');

    await navigate('hotspots&hideUI=false');
    await waitFor(ready, 'animated bed');
    const hotspot = documentInFrame().querySelector('.Hotspot');
    const head = documentInFrame().querySelector('[aria-label="Headboard"]');
    const nurse = documentInFrame().querySelector('[aria-label="Nurse Controller"]');
    head.click(); head.click();
    await waitFor(() => !viewer().paused && viewer().currentTime > 0.1, 'first animation');
    check(hotspot.hidden, 'Hotspot visible during animation');
    nurse.click(); nurse.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    check(viewer().animationName === 'Action.001' && !viewer().paused && viewer().currentTime < 0.5, 'Repeated clicks did not restart the latest clip');
    viewer().timeScale = 8;
    await waitFor(() => viewer().paused && !hotspot.hidden, 'one-shot completion', 5000);
    check(Math.abs(viewer().currentTime - viewer().duration) < 0.05, 'Animation did not stop at its last frame');
    check(events().finishes === 1, 'Unexpected completion count');
    viewer().timeScale = 1;
    head.click();
    await waitFor(() => !viewer().paused, 'play before switching');
    frame.contentWindow.location.hash = '1';
    await waitFor(() => ready() && viewer().src.endsWith('headboard-comp.glb'), 'switch during playback');
    await new Promise(resolve => setTimeout(resolve, 1000));
    check(viewer().paused && !documentInFrame().querySelector('.Hotspot'), 'Stale playback affected new model');
    finish('Animation restart, latest clip, one-shot finish, hotspots, and cancellation');

    await navigate('hotspots&hideUI=true');
    await waitFor(ready, 'hidden UI');
    check(documentInFrame().getElementById('bed-controller-panel').hidden, 'Hidden embed shows controller');
    check(documentInFrame().querySelector('.Hotspot').hidden, 'Hidden embed shows hotspot');
    check(!documentInFrame().querySelector('#bed-controller-panel img'), 'Hidden embed downloads controller');
    check(documentInFrame().getElementById('model-picker').hidden && documentInFrame().getElementById('animation-panel').hidden, 'Hidden embed shows generic controls');
    const shownURL = new URL(frame.contentWindow.location.href);
    shownURL.searchParams.set('hideUI', 'false');
    frame.contentWindow.history.replaceState(null, '', shownURL);
    frame.contentWindow.dispatchEvent(new frame.contentWindow.PopStateEvent('popstate'));
    check(!documentInFrame().getElementById('bed-controller-panel').hidden && !documentInFrame().querySelector('.Hotspot').hidden, 'UI did not restore');
    finish('Hidden embed and URL visibility restoration');

    await navigate('missing&hideUI=false');
    await waitFor(() => !documentInFrame().getElementById('load-status').hidden, 'missing asset error');
    check(viewer().getAttribute('aria-busy') === 'false', 'Failure leaves viewer busy');
    frame.contentWindow.location.hash = '1';
    await waitFor(() => ready() && viewer().src.endsWith('headboard-comp.glb'), 'recovery to valid asset');
    check(documentInFrame().getElementById('load-status').hidden, 'Error survived model switch');
    finish('Missing asset and recovery by model selection');

    await navigate('retry&hideUI=false');
    await waitFor(() => !documentInFrame().getElementById('load-status').hidden, 'intentional transient failure');
    const failedURL = viewer().src;
    const reloaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    documentInFrame().getElementById('retry-load').click();
    await reloaded;
    await waitFor(ready, 'retry same source');
    check(viewer().src === failedURL && events().errors === 0 && events().loads.length === 1, 'Retry did not load the original URL');
    check(documentInFrame().getElementById('load-status').hidden, 'Retry did not clear error');
    finish('Retry the same URL after a transient failure');

    await navigate('generic&hideUI=false', '2');
    await waitFor(ready, 'generic imported model');
    const select = documentInFrame().getElementById('model-select');
    check(select.value === 'generic' && !documentInFrame().getElementById('model-picker').hidden, 'Model picker does not reflect numeric hash');
    check(documentInFrame().querySelectorAll('#animation-panel button').length === 2, 'Embedded animations were not discovered');
    check(documentInFrame().getElementById('bed-controller-panel').hidden, 'Generic model inherited an image controller');
    const genericButtons = [...documentInFrame().querySelectorAll('#animation-panel button')];
    const genericHead = genericButtons.find(button => button.textContent === 'Action');
    const genericNurse = genericButtons.find(button => button.textContent === 'Action.001');
    genericHead.click(); genericHead.click(); genericNurse.click();
    await waitFor(() => !viewer().paused && viewer().animationName === 'Action.001', 'generic animation restart');
    viewer().timeScale = 8;
    await waitFor(() => viewer().paused && events().finishes === 1, 'generic one-shot finish', 5000);
    select.value = 'headboard';
    select.dispatchEvent(new frame.contentWindow.Event('change'));
    await waitFor(() => ready() && frame.contentWindow.location.hash === '#1' && viewer().src.endsWith('headboard-comp.glb'), 'picker model change');
    check(documentInFrame().getElementById('animation-panel').hidden, 'Generic animation controls survived switching');
    await navigate('generic&hideUI=true', '2');
    await waitFor(ready, 'hidden generic imported model');
    check(documentInFrame().getElementById('model-picker').hidden && documentInFrame().getElementById('animation-panel').hidden, 'Generic embed ignores hideUI');
    check(documentInFrame().querySelectorAll('#animation-panel button').length === 0, 'Hidden generic embed generated buttons');
    finish('Imported model selection, discovered animations, repeated playback, switching, and hidden controls');

    await navigate('generic&hideUI=false', '2');
    await waitFor(ready, 'live configuration base');
    const nativeConfig = await fetch('/hotspot.json').then(response => response.json());
    const liveConfig = { ...nativeConfig, models: { ...nativeConfig.models,
      generic: { file: 'Z7z-optimized.glb', displayName: 'Imported model', hotspots: [] },
      live: { file: 'headboard-comp.glb', displayName: 'New live entry', hotspots: [] } } };
    const liveURL = frame.contentWindow.location.href;
    const liveLoads = events().loads.length;
    viewer().animationName = 'Action';
    await viewer().updateComplete;
    viewer().currentTime = 0.4;
    const savedTime = viewer().currentTime;
    frame.contentWindow.viewerTestConfig = liveConfig;
    frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('models-config-changed'));
    await waitFor(() => documentInFrame().querySelector('#model-select option[value="live"]'), 'new live entry');
    check(frame.contentWindow.location.href === liveURL && events().loads.length === liveLoads && Math.abs(viewer().currentTime - savedTime) < 0.05, 'Adding entries reset the current model or animation pose');
    const liveSelect = documentInFrame().getElementById('model-select');
    liveSelect.value = 'Z7z';
    liveSelect.dispatchEvent(new frame.contentWindow.Event('change'));
    await waitFor(() => ready() && liveSelect.value === 'Z7z', 'same-asset alias selection');
    check(documentInFrame().querySelectorAll('.controller-btn').length === 2, 'Same-asset alias lost its controls');
    check(events().loads.length === liveLoads, 'Same-asset alias reloaded geometry');
    liveConfig.models.Z7z.file = 'headboard-comp.glb';
    frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('models-config-changed'));
    await waitFor(() => ready() && viewer().src.endsWith('headboard-comp.glb'), 'changed selected asset');
    frame.contentWindow.viewerTestConfig = { models: {} };
    frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('models-config-changed'));
    await new Promise(resolve => setTimeout(resolve, 150));
    check(ready() && viewer().src.endsWith('headboard-comp.glb') && documentInFrame().querySelector('#model-select option[value="live"]'), 'Invalid live config discarded working models');
    finish('Live entry discovery, retained pose, same-asset aliases, updated sources, and invalid-config recovery');

    results.textContent = JSON.stringify({ passed, failed: [], complete: true, viewport: { width: innerWidth, height: innerHeight, frameWidth: frame.contentWindow.innerWidth } }, null, 2);
  } catch (error) {
    results.textContent = JSON.stringify({ passed, failed: [error.message], complete: true }, null, 2);
  } finally {
    document.getElementById('regression').disabled = false;
  }
};
