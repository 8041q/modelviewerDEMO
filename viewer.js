const viewer = document.getElementById('viewer');
const controllerPanel = document.getElementById('bed-controller-panel');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const statusPanel = document.getElementById('load-status');
const statusMessage = document.getElementById('load-message');
const retryButton = document.getElementById('retry-load');
const modelPicker = document.getElementById('model-picker');
const modelSelect = document.getElementById('model-select');
const animationPanel = document.getElementById('animation-panel');

let modelsConfig;
let modelKeysArray = [];
let currentModel = null;
let loadState = 'idle';
let viewerReady = false;
let hideUIControls = false;
let playing = false;
let loadVersion = 0;
let playbackVersion = 0;
let loadAbortController;
let playbackAbortController;
let progressResetTimer;
let refreshingConfig = false;
let configRefreshPending = false;
const failedSources = new Set();

function parseURLParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('hideUI')) url.searchParams.set('hideUI', 'false');
  if (!url.hash) url.hash = '0';
  if (url.href !== window.location.href) history.replaceState(null, '', url);
  hideUIControls = url.searchParams.get('hideUI') === 'true';
}

function modelFromHash() {
  const hash = window.location.hash.slice(1);
  const index = /^\d+$/.test(hash) ? Number(hash) : -1;
  return modelKeysArray[index] || modelKeysArray[0];
}

function applyUIVisibility() {
  document.body.classList.toggle('hide-ui', hideUIControls);
  modelPicker.hidden = hideUIControls || modelKeysArray.length < 2;
  // Avoid downloading the controller image in embeds that hide the UI.
  if (!hideUIControls && loadState === 'ready' && !controllerPanel.childElementCount) renderController(currentModel);
  controllerPanel.hidden = hideUIControls || loadState !== 'ready' || !controllerPanel.childElementCount;
  animationPanel.hidden = hideUIControls || loadState !== 'ready' || !animationPanel.childElementCount;
  viewer.querySelectorAll('.Hotspot').forEach(hotspot => {
    hotspot.hidden = hideUIControls || playing || loadState !== 'ready';
  });
}

function clearControls() {
  viewer.querySelectorAll('.Hotspot').forEach(hotspot => hotspot.remove());
  controllerPanel.replaceChildren();
  controllerPanel.hidden = true;
  animationPanel.replaceChildren();
  animationPanel.hidden = true;
}

function renderController(modelName) {
  const controller = modelsConfig?.models[modelName]?.controller;
  if (hideUIControls) return;
  if (!controller) {
    if (animationPanel.childElementCount) return;
    for (const animation of viewer.availableAnimations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = animation;
      button.addEventListener('click', () => playAnimation(animation));
      animationPanel.appendChild(button);
    }
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'controller-wrapper';
  const image = document.createElement('img');
  image.src = controller.image;
  image.alt = `${modelsConfig.models[modelName].displayName || modelName} controller`;
  image.draggable = false;
  wrapper.appendChild(image);
  for (const config of controller.buttons || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'controller-btn';
    button.style.left = `${config.x}%`;
    button.style.top = `${config.y}%`;
    button.style.width = `${config.width}%`;
    button.style.paddingBottom = `${config.width}%`;
    button.setAttribute('aria-label', config.label);
    button.title = config.label;
    button.disabled = !viewer.availableAnimations.includes(config.animation);
    button.addEventListener('click', () => playAnimation(config.animation));
    wrapper.appendChild(button);
  }
  controllerPanel.replaceChildren(wrapper);
}

function addHotspots(modelName) {
  for (const [index, config] of (modelsConfig.models[modelName].hotspots || []).entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'Hotspot';
    button.slot = `hotspot-${index + 1}`;
    button.setAttribute('data-surface', config.surface);
    button.setAttribute('data-visibility-attribute', 'visible');
    button.setAttribute('aria-label', config.label);
    button.disabled = !viewer.availableAnimations.includes(config.animation);
    const annotation = document.createElement('div');
    annotation.className = 'HotspotAnnotation';
    annotation.textContent = config.label;
    button.appendChild(annotation);
    button.addEventListener('click', () => playAnimation(config.animation));
    viewer.appendChild(button);
  }
}

function stopAnimations() {
  playbackVersion++;
  playbackAbortController?.abort();
  playing = false;
  if (viewerReady) viewer.pause();
}

async function playAnimation(animationName) {
  if (loadState !== 'ready' || !viewer.availableAnimations.includes(animationName)) return;
  stopAnimations();
  const version = playbackVersion;
  const modelVersion = loadVersion;
  playbackAbortController = new AbortController();
  playing = true;
  applyUIVisibility();
  viewer.animationName = animationName;
  // Wait for the named clip to be selected; a fixed delay races on slow devices.
  await viewer.updateComplete;
  if (version !== playbackVersion || modelVersion !== loadVersion || loadState !== 'ready') return;
  viewer.currentTime = 0;
  viewer.addEventListener('finished', () => {
    if (version !== playbackVersion || modelVersion !== loadVersion) return;
    playing = false;
    applyUIVisibility();
  }, { once: true, signal: playbackAbortController.signal });
  viewer.play({ repetitions: 1 });
}

function showError(message) {
  clearTimeout(progressResetTimer);
  progressContainer.hidden = true;
  statusMessage.textContent = message;
  statusPanel.hidden = false;
  applyUIVisibility();
}

function setModel(modelName) {
  const config = modelsConfig?.models[modelName];
  if (!viewerReady || !config) return;
  const expectedSource = new URL(config.file, document.baseURI).href;
  const sameSource = new URL(viewer.src || '', document.baseURI).href === expectedSource;
  const index = modelKeysArray.indexOf(modelName);
  if (window.location.hash !== `#${index}`) {
    const url = new URL(window.location.href);
    url.hash = index.toString();
    history.replaceState(null, '', url);
  }
  // Version 4 caches failed model loads internally. Reload this viewer document
  // to retry the original URL, including URLs whose query parameters are signed.
  if (failedSources.has(config.file)) { window.location.reload(); return; }
  if (currentModel === modelName && sameSource && loadState !== 'error') return;
  loadAbortController?.abort();
  loadAbortController = new AbortController();
  const { signal } = loadAbortController;
  const version = ++loadVersion;
  currentModel = modelName;
  modelSelect.value = modelName;
  loadState = 'loading';
  clearTimeout(progressResetTimer);
  stopAnimations();
  clearControls();
  statusPanel.hidden = true;
  progressContainer.hidden = false;
  progressBar.style.width = '0%';
  viewer.setAttribute('aria-busy', 'true');
  viewer.animationName = undefined;
  viewer.alt = config.displayName || modelName;
  const isCurrent = event => version === loadVersion && currentModel === modelName
    && new URL(viewer.src, document.baseURI).href === expectedSource
    && (!event.detail?.url || new URL(event.detail.url, document.baseURI).href === expectedSource);

  // Attach before src changes: a cached model can finish immediately.
  const onLoad = event => {
    if (!isCurrent(event) || !viewer.loaded) return;
    loadState = 'ready';
    viewer.setAttribute('aria-busy', 'false');
    addHotspots(modelName);
    applyUIVisibility();
    progressBar.style.width = '100%';
    progressResetTimer = setTimeout(() => {
      if (version !== loadVersion) return;
      progressContainer.hidden = true;
      progressBar.style.width = '0%';
    }, 500);
    loadAbortController.abort();
  };
  viewer.addEventListener('load', onLoad, { signal });
  viewer.addEventListener('progress', event => {
    if (!isCurrent(event)) return;
    const ratio = Math.max(0, Math.min(1, event.detail.totalProgress || 0));
    progressBar.style.width = `${ratio * 100}%`;
  }, { signal });
  viewer.addEventListener('error', event => {
    if (!isCurrent(event)) return;
    loadState = 'error';
    failedSources.add(config.file);
    viewer.setAttribute('aria-busy', 'false');
    stopAnimations();
    clearControls();
    showError('Unable to load this model. Please try again.');
    loadAbortController.abort();
  }, { signal });

  // Two entries can share an already loaded asset. Reusing its URL emits no new load event.
  if (sameSource && viewer.loaded) onLoad({});
  else viewer.src = config.file;
  applyUIVisibility();
}

function selectFromURL() {
  parseURLParams();
  if (viewerReady && modelKeysArray.length) setModel(modelFromHash());
  applyUIVisibility();
}
window.addEventListener('hashchange', selectFromURL);
window.addEventListener('popstate', selectFromURL);

async function fetchConfig() {
  const response = await fetch('hotspot.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Unable to load hotspot.json');
  const json = await response.json();
  if (!json.models || Array.isArray(json.models) || typeof json.models !== 'object' || !Object.keys(json.models).length
    || Object.values(json.models).some(model => !model || typeof model.file !== 'string' || !model.file)) throw new Error('Invalid model configuration');
  return json;
}

function applyConfig(config) {
  const previous = modelsConfig?.models[currentModel];
  modelsConfig = config;
  modelKeysArray = Object.keys(config.models);
  const options = modelKeysArray.map(key => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = config.models[key].displayName || key;
    return option;
  });
  modelSelect.replaceChildren(...options);
  if (!currentModel) { selectFromURL(); return; }
  const selected = Object.hasOwn(config.models, currentModel) ? currentModel : modelKeysArray[0];
  modelSelect.value = selected;
  if (selected === currentModel && previous?.file === config.models[selected].file) {
    // Adding other models leaves the camera and running animation alone.
    if (JSON.stringify(previous) !== JSON.stringify(config.models[selected]) && loadState === 'ready') {
      clearControls();
      viewer.alt = config.models[selected].displayName || selected;
      addHotspots(selected);
    }
  }
  setModel(selected);
  applyUIVisibility();
}

async function refreshConfig() {
  configRefreshPending = true;
  if (!viewerReady || refreshingConfig) return;
  refreshingConfig = true;
  try {
    while (configRefreshPending) {
      configRefreshPending = false;
      const config = await fetchConfig();
      if (JSON.stringify(config) !== JSON.stringify(modelsConfig)) applyConfig(config);
    }
  } catch (error) {
    console.warn('Keeping the current models until a valid configuration is available.', error);
  } finally {
    refreshingConfig = false;
    if (configRefreshPending) refreshConfig();
  }
}
window.addEventListener('models-config-changed', refreshConfig);

async function initialize() {
  statusPanel.hidden = true;
  try {
    const [config] = await Promise.all([
      fetchConfig(),
      // Import failures can be surfaced to the user, unlike an unresolved whenDefined.
      import('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js').then(() => customElements.whenDefined('model-viewer')),
    ]);
    viewerReady = true;
    applyConfig(config);
    if (configRefreshPending) refreshConfig();
  } catch (error) {
    console.error(error);
    loadState = 'error';
    showError('Unable to start the viewer. Please try again.');
  }
}

retryButton.addEventListener('click', () => {
  window.location.reload();
});
modelSelect.addEventListener('change', () => {
  window.location.hash = modelKeysArray.indexOf(modelSelect.value).toString();
});

initialize();
