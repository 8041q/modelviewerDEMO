const viewer = document.getElementById('viewer');
const controlsContainer = document.getElementById('model-controls');

let modelsConfig = null;
let currentModel = null;
let hideUIControls = false;
let modelKeysArray = [];

let loadAbortController = null;

// Get model name by numeric index
function getModelByIndex(index) {
  if (index < 0 || index >= modelKeysArray.length) return null;
  return modelKeysArray[index];
}

// Parse URL query parameter for hideUI toggle
function parseURLParams() {
  const params = new URLSearchParams(window.location.search);
  hideUIControls = params.get('hideUI') === 'true';
}

// Apply UI visibility based on hideUIControls flag
function applyUIVisibility() {
  if (hideUIControls) {
    controlsContainer.classList.add('hidden');
    document.body.classList.add('hide-ui');
  } else {
    controlsContainer.classList.remove('hidden');
    document.body.classList.remove('hide-ui');
  }
}

// Handle hash changes for model selection
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  if (hash === '') return;
  const modelIndex = parseInt(hash, 10);
  if (!isNaN(modelIndex)) {
    const modelName = getModelByIndex(modelIndex);
    if (modelName) setModel(modelName);
  }
});

// Fetch JSON once at page load
async function loadHotspotConfig() {
  try {
    const res = await fetch('hotspot.json');
    if (!res.ok) throw new Error('Failed to load hotspot.json');
    modelsConfig = await res.json();
    parseURLParams();
    initializeViewer();
  } catch (err) {
    console.error(err);
  }
}

function initializeViewer() {
  modelKeysArray = Object.keys(modelsConfig.models);
  if (!modelKeysArray.length) return console.error('No models in JSON');

  // Create buttons for each model
  modelKeysArray.forEach((modelName, index) => {
    const btn = document.createElement('button');
    btn.textContent = modelsConfig.models[modelName].displayName || modelName;
    btn.onclick = () => {
      window.location.hash = index.toString();
      setModel(modelName);
    };
    if (index === 0) btn.classList.add('active');
    controlsContainer.appendChild(btn);
  });

  // Check for hash in URL, otherwise load first model
  const hash = window.location.hash.slice(1);
  if (hash === '' || hash === undefined) {
    setModel(modelKeysArray[0]);
  } else {
    const modelIndex = parseInt(hash, 10);
    if (!isNaN(modelIndex)) {
      const modelName = getModelByIndex(modelIndex);
      if (modelName) {
        setModel(modelName);
      } else {
        setModel(modelKeysArray[0]);
      }
    } else {
      setModel(modelKeysArray[0]);
    }
  }
  
  applyUIVisibility();
}

function clearHotspots() {
  viewer.querySelectorAll('.Hotspot').forEach(h => h.remove());
}

function addHotspots(modelName) {
  clearHotspots();
  const modelConfig = modelsConfig.models[modelName];
  if (!modelConfig || !modelConfig.hotspots) return;

  modelConfig.hotspots.forEach((h, i) => {
    const btn = document.createElement('button');
    btn.className = 'Hotspot';
    btn.slot = `hotspot-${i+1}`;
    btn.setAttribute('data-surface', h.surface);
    btn.setAttribute('data-visibility-attribute', 'visible');

    const annotation = document.createElement('div');
    annotation.className = 'HotspotAnnotation';
    annotation.textContent = h.label;
    btn.appendChild(annotation);

    btn.onclick = () => playAnimation(h.animation, btn);
    viewer.appendChild(btn);
  });
}

function playAnimation(animationName, hotspot) {
  const allHotspots = viewer.querySelectorAll('.Hotspot');
  allHotspots.forEach(h => h.style.display = 'none');

  viewer.pause();
  viewer.animationName = animationName;
  viewer.currentTime = 0;

  const duration = 250 / 30;

  setTimeout(() => {
    viewer.play();
    setTimeout(() => {
      viewer.pause();
      allHotspots.forEach(h => h.style.display = 'flex');
    }, duration * 1000);
  }, 50);
}

function setModel(modelName) {
  if (!modelsConfig?.models[modelName]) return;
  if (currentModel === modelName) return;

  // Cancel any pending load listener
  if (loadAbortController) loadAbortController.abort();
  loadAbortController = new AbortController();

  clearHotspots();
  stopAnimations();

  viewer.src = modelsConfig.models[modelName].file;

  // Update active button
  controlsContainer.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (modelsConfig.models[modelName].displayName || modelName));
  });
  
  // Update URL hash to reflect current model (find index of model)
  const modelIndex = modelKeysArray.indexOf(modelName);
  if (modelIndex >= 0) {
    window.location.hash = modelIndex.toString();
  }
  
  applyUIVisibility();

  viewer.addEventListener(
    'load',
    () => addHotspots(modelName),
    { once: true, signal: loadAbortController.signal }
  );
}

function stopAnimations() {
  viewer.pause();
  viewer.animationName = '';
}


// Progress bar handling
const progressBar = document.getElementById('progress-bar');

viewer.addEventListener('progress', (event) => {
  const ratio = event.detail.totalProgress || 0;
  progressBar.style.width = `${ratio * 100}%`;
});

viewer.addEventListener('load', () => {
  progressBar.style.width = '100%';
  setTimeout(() => {
    progressBar.style.width = '0%';
  }, 500); // smooth fade out
});


// Start everything
loadHotspotConfig();
