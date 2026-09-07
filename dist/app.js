const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const stage = document.querySelector('.stage-shell');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const textEditor = document.getElementById('textEditor');
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');

const GALLERY_DB_NAME = 'skitch-studio';
const GALLERY_STORE = 'gallery';
const GALLERY_LIMIT = 12;

const controls = {
  color: document.getElementById('colorInput'),
  fill: document.getElementById('fillInput'),
  size: document.getElementById('sizeInput'),
  opacity: document.getElementById('opacityInput'),
  font: document.getElementById('fontInput'),
  bold: document.getElementById('boldInput'),
  shadow: document.getElementById('shadowInput'),
  depth: document.getElementById('depthInput'),
  bg: document.getElementById('bgInput'),
};

const stamps = [
  '★', '✓', '!', '?', '❤', '⚑', '⌖', '☰', '✚', '✕',
  '⌂', '⌁', '◉', '⬢', '◆', '●', '▲', '■', '◌', '⬒',
  '😀', '😂', '😍', '😎', '🤔', '👏', '👍', '👎', '🔥', '🎉',
  '🚀', '💡', '👀', '✅', '❌', '⚠️', '📌', '💬', '❤️', '💯'
];
let state = {
  tool: 'select',
  stamp: '★',
  bgImage: null,
  bgData: null,
  objects: [],
  selected: null,
  drawing: null,
  drag: null,
  resize: null,
  history: [],
  redo: [],
};
let galleryEntries = [];
let activeGalleryId = null;
const galleryDbPromise = openGalleryDatabase();

function styleFromControls() {
  return {
    color: controls.color.value,
    fill: controls.fill.value,
    size: Number(controls.size.value),
    opacity: Number(controls.opacity.value) / 100,
    font: controls.font.value,
    bold: controls.bold.checked,
    shadow: controls.shadow.checked,
    depth: controls.depth.checked,
  };
}

function pushHistory() {
  state.history.push(JSON.stringify({ objects: state.objects, bgData: state.bgData }));
  if (state.history.length > 80) state.history.shift();
  state.redo = [];
}

function restore(snapshot) {
  const data = JSON.parse(snapshot);
  state.objects = data.objects || [];
  state.bgData = data.bgData || null;
  state.bgImage = null;
  if (state.bgData) {
    const img = new Image();
    img.onload = () => {
      state.bgImage = img;
      resizeCanvas(img.width, img.height);
      render();
    };
    img.src = state.bgData;
  } else {
    render();
  }
}

function resizeCanvas(w, h) {
  const maxW = 1800;
  const scale = Math.min(1, maxW / w);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  metaEl.textContent = `${canvas.width} × ${canvas.height}`;
}

async function makeDemo(savePrevious = true) {
  if (savePrevious) await saveCurrentToGallery({ silent: true });
  activeGalleryId = null;
  pushHistory();
  state.bgImage = null;
  state.bgData = null;
  resizeCanvas(1280, 820);
  state.objects = [
    { id: crypto.randomUUID(), type: 'rect', x: 300, y: 135, w: 420, h: 190, ...styleFromControls(), size: 8 },
    { id: crypto.randomUUID(), type: 'arrow', x: 770, y: 210, x2: 1000, y2: 135, ...styleFromControls(), size: 14 },
    { id: crypto.randomUUID(), type: 'text', x: 330, y: 170, w: 340, h: 96, text: 'Editable callout\\nChange size, color, font', ...styleFromControls(), size: 34, fill: '#ffffff' },
    { id: crypto.randomUUID(), type: 'icon', x: 925, y: 380, stamp: '★', ...styleFromControls(), size: 88, depth: true },
    { id: crypto.randomUUID(), type: 'highlight', x: 250, y: 550, w: 770, h: 54, ...styleFromControls(), fill: '#fff3a1', opacity: .7 },
  ];
  state.selected = state.objects[2].id;
  status('Demo canvas loaded.');
  render();
}

function status(text) {
  statusEl.textContent = text;
}

function openGalleryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GALLERY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GALLERY_STORE)) {
        request.result.createObjectStore(GALLERY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readGalleryEntries() {
  const db = await galleryDbPromise;
  return new Promise((resolve, reject) => {
    const request = db.transaction(GALLERY_STORE).objectStore(GALLERY_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeGalleryEntry(entry) {
  const db = await galleryDbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(GALLERY_STORE, 'readwrite');
    transaction.objectStore(GALLERY_STORE).put(entry);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function removeGalleryEntry(id) {
  const db = await galleryDbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(GALLERY_STORE, 'readwrite');
    transaction.objectStore(GALLERY_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearGalleryEntries() {
  const db = await galleryDbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(GALLERY_STORE, 'readwrite');
    transaction.objectStore(GALLERY_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function captureCleanCanvas() {
  const selected = state.selected;
  state.selected = null;
  render();
  const imageData = canvas.toDataURL('image/png');
  state.selected = selected;
  render();
  return imageData;
}

async function saveImageToGallery(imageData, { silent = false } = {}) {
  const currentEntry = galleryEntries.find(item => item.id === activeGalleryId);
  const entry = {
    id: activeGalleryId || crypto.randomUUID(),
    imageData,
    width: canvas.width,
    height: canvas.height,
    createdAt: currentEntry?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  activeGalleryId = entry.id;

  try {
    await writeGalleryEntry(entry);
    galleryEntries = [entry, ...galleryEntries.filter(item => item.id !== entry.id)];
    const overflow = galleryEntries.splice(GALLERY_LIMIT);
    await Promise.all(overflow.map(item => removeGalleryEntry(item.id)));
    renderGallery();
    if (!silent) status('Current edit saved to the gallery.');
  } catch {
    if (!silent) status('The gallery could not save this image in your browser.');
  }
}

function saveCurrentToGallery(options) {
  return saveImageToGallery(captureCleanCanvas(), options);
}

function renderGallery() {
  galleryGrid.replaceChildren();
  galleryEmpty.hidden = galleryEntries.length > 0;

  galleryEntries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    const openButton = document.createElement('button');
    openButton.className = 'gallery-open';
    openButton.type = 'button';
    openButton.title = 'Open this saved image';

    const image = document.createElement('img');
    image.src = entry.imageData;
    image.alt = `Saved edit from ${new Date(entry.updatedAt || entry.createdAt).toLocaleString()}`;

    const meta = document.createElement('span');
    meta.className = 'gallery-meta';
    meta.textContent = new Date(entry.updatedAt || entry.createdAt).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });

    openButton.append(image, meta);
    openButton.addEventListener('click', () => openGalleryEntry(entry));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'gallery-delete';
    deleteButton.type = 'button';
    deleteButton.title = 'Remove from gallery';
    deleteButton.setAttribute('aria-label', 'Remove saved image from gallery');
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', async () => {
      try {
        await removeGalleryEntry(entry.id);
        galleryEntries = galleryEntries.filter(item => item.id !== entry.id);
        if (activeGalleryId === entry.id) activeGalleryId = null;
        renderGallery();
        status('Saved image removed from the gallery.');
      } catch {
        status('The saved image could not be removed.');
      }
    });

    item.append(openButton, deleteButton);
    galleryGrid.appendChild(item);
  });
}

async function openGalleryEntry(entry) {
  if (activeGalleryId !== entry.id) await saveCurrentToGallery({ silent: true });
  activeGalleryId = entry.id;
  pushHistory();
  const img = new Image();
  img.onload = () => {
    state.bgData = entry.imageData;
    state.bgImage = img;
    state.objects = [];
    state.selected = null;
    resizeCanvas(entry.width || img.width, entry.height || img.height);
    status('Saved image opened. You can continue annotating it.');
    render();
  };
  img.src = entry.imageData;
}

async function loadGallery() {
  try {
    const storedEntries = (await readGalleryEntries()).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    const seenImages = new Set();
    const duplicates = [];
    galleryEntries = storedEntries.filter(entry => {
      if (seenImages.has(entry.imageData)) {
        duplicates.push(entry);
        return false;
      }
      seenImages.add(entry.imageData);
      return true;
    });
    const overflow = galleryEntries.splice(GALLERY_LIMIT);
    await Promise.all([...duplicates, ...overflow].map(entry => removeGalleryEntry(entry.id)));
    renderGallery();
  } catch {
    galleryEmpty.textContent = 'Gallery storage is unavailable in this browser.';
  }
}

function getPointer(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  status(tool === 'text' ? 'Click to place text, double-click text to edit.' : `${tool[0].toUpperCase()}${tool.slice(1)} tool selected.`);
}

function initStamps() {
  const grid = document.getElementById('stampGrid');
  stamps.forEach(stamp => {
    const btn = document.createElement('button');
    btn.className = `stamp${stamp === state.stamp ? ' active' : ''}`;
    btn.textContent = stamp;
    btn.title = `Stamp ${stamp}`;
    btn.addEventListener('click', () => {
      state.stamp = stamp;
      setTool('icon');
      document.querySelectorAll('.stamp').forEach(b => b.classList.toggle('active', b === btn));
    });
    grid.appendChild(btn);
  });
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.bgImage) {
    ctx.drawImage(state.bgImage, 0, 0, canvas.width, canvas.height);
    return;
  }
  const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grd.addColorStop(0, '#f7fbff');
  grd.addColorStop(.55, '#eef4f8');
  grd.addColorStop(1, '#ffffff');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#dce4ee';
  ctx.fillRect(80, 90, canvas.width - 160, canvas.height - 180);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(115, 130, canvas.width - 230, canvas.height - 260);
  ctx.fillStyle = '#8b98a8';
  ctx.font = '700 34px Inter, Arial';
  ctx.fillText('Drop, paste, or import an image', 160, 215);
  ctx.font = '20px Inter, Arial';
  ctx.fillText('Then annotate with arrows, shapes, text, stamps, blur, pixelate, and 3D effects.', 160, 255);
}

function applyShadow(obj) {
  if (!obj.shadow && !obj.depth) return;
  ctx.shadowColor = obj.depth ? 'rgba(37, 99, 235, .35)' : 'rgba(0, 0, 0, .22)';
  ctx.shadowBlur = obj.depth ? 2 : 10;
  ctx.shadowOffsetX = obj.depth ? 8 : 2;
  ctx.shadowOffsetY = obj.depth ? 9 : 3;
}

function clearShadow() {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawObject(obj) {
  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = obj.color;
  ctx.fillStyle = obj.fill;
  ctx.lineWidth = obj.size || 8;
  applyShadow(obj);

  if (obj.type === 'rect' || obj.type === 'highlight') {
    ctx.fillStyle = obj.type === 'highlight' ? obj.fill : `${obj.fill}33`;
    ctx.strokeStyle = obj.type === 'highlight' ? 'transparent' : obj.color;
    roundRect(obj.x, obj.y, obj.w, obj.h, 8);
    ctx.fill();
    if (obj.type === 'rect') ctx.stroke();
  }

  if (obj.type === 'arrow') {
    drawArrow(obj.x, obj.y, obj.x2, obj.y2, obj.size, obj.color, obj.depth);
  }

  if (obj.type === 'pen') {
    ctx.beginPath();
    obj.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }

  if (obj.type === 'text') {
    drawText(obj);
  }

  if (obj.type === 'icon') {
    drawIcon(obj);
  }

  if (obj.type === 'blur' || obj.type === 'pixelate') {
    drawPrivacyPatch(obj);
  }

  clearShadow();
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  const left = Math.min(x, x + w);
  const top = Math.min(y, y + h);
  const width = Math.abs(w);
  const height = Math.abs(h);
  const radius = Math.min(r, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + height, radius);
  ctx.arcTo(left + width, top + height, left, top + height, radius);
  ctx.arcTo(left, top + height, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
}

function drawArrow(x1, y1, x2, y2, size, color, depth) {
  if (depth) {
    ctx.strokeStyle = '#2f8cff';
    ctx.fillStyle = '#2f8cff';
    ctx.lineWidth = Math.max(2, size * .55);
    arrowPath(x1 + 10, y1 + 10, x2 + 10, y2 + 10, size);
    ctx.stroke();
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  arrowPath(x1, y1, x2, y2, size);
  ctx.stroke();
  ctx.fill();
}

function arrowPath(x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(18, size * 3);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
}

function drawText(obj) {
  const weight = obj.bold ? '800' : '600';
  ctx.font = `${weight} ${obj.size}px ${obj.font}, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const lines = String(obj.text || '').split('\n');
  const lineH = obj.size * 1.2;
  if (obj.fill) {
    ctx.fillStyle = obj.fill;
    roundRect(obj.x - 8, obj.y - 6, obj.w || 260, obj.h || (lines.length * lineH + 16), 6);
    ctx.fill();
  }
  if (obj.depth) {
    ctx.fillStyle = '#2f8cff';
    lines.forEach((line, i) => ctx.fillText(line, obj.x + 5, obj.y + i * lineH + 5));
  }
  ctx.fillStyle = obj.color;
  lines.forEach((line, i) => ctx.fillText(line, obj.x, obj.y + i * lineH));
}

function drawIcon(obj) {
  ctx.font = `900 ${obj.size}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (obj.depth) {
    ctx.fillStyle = '#2f8cff';
    ctx.fillText(obj.stamp, obj.x + 8, obj.y + 9);
  }
  ctx.fillStyle = obj.color;
  ctx.fillText(obj.stamp, obj.x, obj.y);
  ctx.textAlign = 'start';
}

function drawPrivacyPatch(obj) {
  const raw = bounds(obj);
  const x = Math.max(0, Math.floor(raw.x));
  const y = Math.max(0, Math.floor(raw.y));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(raw.w)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(raw.h)));
  const imageData = ctx.getImageData(x, y, w, h);
  if (obj.type === 'blur') {
    ctx.fillStyle = 'rgba(235, 242, 250, .86)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  } else {
    const cell = Math.max(8, Math.round((obj.size || 16) / 1.7));
    for (let py = 0; py < h; py += cell) {
      for (let px = 0; px < w; px += cell) {
        const idx = ((Math.min(h - 1, py) * imageData.width) + Math.min(w - 1, px)) * 4;
        ctx.fillStyle = `rgb(${imageData.data[idx]}, ${imageData.data[idx + 1]}, ${imageData.data[idx + 2]})`;
        ctx.fillRect(x + px, y + py, cell, cell);
      }
    }
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }
}

function drawSelection(obj) {
  const box = bounds(obj);
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#2f8cff';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
  ctx.setLineDash([]);
  ctx.fillStyle = '#2f8cff';
  selectionHandles(box).forEach(({ x, y }) => {
    ctx.fillRect(x - 4, y - 4, 8, 8);
  });
  ctx.restore();
}

function selectionHandles(box) {
  return [
    { name: 'nw', x: box.x - 6, y: box.y - 6 },
    { name: 'ne', x: box.x + box.w + 6, y: box.y - 6 },
    { name: 'se', x: box.x + box.w + 6, y: box.y + box.h + 6 },
    { name: 'sw', x: box.x - 6, y: box.y + box.h + 6 },
  ];
}

function resizeHandleAt(point, obj) {
  if (!obj) return null;
  const rect = canvas.getBoundingClientRect();
  const tolerance = 12 * canvas.width / rect.width;
  return selectionHandles(bounds(obj)).find(handle =>
    Math.abs(point.x - handle.x) <= tolerance && Math.abs(point.y - handle.y) <= tolerance
  )?.name || null;
}

function mapCoordinate(value, oldStart, oldLength, newStart, newLength) {
  if (oldLength < 1) return newStart + newLength / 2;
  return newStart + ((value - oldStart) / oldLength) * newLength;
}

function resizeObject(obj, resize, point) {
  const original = resize.original;
  const oldBox = resize.box;
  const handle = resize.handle;
  const anchorX = handle.includes('w') ? oldBox.x + oldBox.w : oldBox.x;
  const anchorY = handle.includes('n') ? oldBox.y + oldBox.h : oldBox.y;
  const left = Math.min(anchorX, point.x);
  const top = Math.min(anchorY, point.y);
  const newBox = {
    x: left,
    y: top,
    w: Math.max(12, Math.abs(point.x - anchorX)),
    h: Math.max(12, Math.abs(point.y - anchorY)),
  };
  const scaleX = newBox.w / Math.max(1, oldBox.w);
  const scaleY = newBox.h / Math.max(1, oldBox.h);
  const mapX = value => mapCoordinate(value, oldBox.x, oldBox.w, newBox.x, newBox.w);
  const mapY = value => mapCoordinate(value, oldBox.y, oldBox.h, newBox.y, newBox.h);

  if (original.type === 'icon') {
    obj.x = newBox.x + newBox.w / 2;
    obj.y = newBox.y + newBox.h / 2;
    obj.size = Math.min(300, Math.max(16, original.size * Math.max(scaleX, scaleY)));
    return;
  }

  if (original.type === 'arrow') {
    obj.x = mapX(original.x);
    obj.y = mapY(original.y);
    obj.x2 = mapX(original.x2);
    obj.y2 = mapY(original.y2);
    return;
  }

  if (original.type === 'pen') {
    obj.points = original.points.map(p => ({ x: mapX(p.x), y: mapY(p.y) }));
    return;
  }

  if (original.type === 'text') {
    obj.x = newBox.x + 8;
    obj.y = newBox.y + 8;
    obj.w = newBox.w;
    obj.h = newBox.h;
    obj.size = Math.min(300, Math.max(10, original.size * Math.min(scaleX, scaleY)));
    return;
  }

  obj.x = newBox.x;
  obj.y = newBox.y;
  obj.w = newBox.w;
  obj.h = newBox.h;
}

function bounds(obj) {
  if (obj.type === 'arrow') return rectFromPoints(obj.x, obj.y, obj.x2, obj.y2);
  if (obj.type === 'icon') return { x: obj.x - obj.size / 2, y: obj.y - obj.size / 2, w: obj.size, h: obj.size };
  if (obj.type === 'text') return { x: obj.x - 8, y: obj.y - 8, w: obj.w || 260, h: obj.h || obj.size * 1.5 };
  if (obj.type === 'pen') {
    const xs = obj.points.map(p => p.x);
    const ys = obj.points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: Math.min(obj.x, obj.x + obj.w), y: Math.min(obj.y, obj.y + obj.h), w: Math.abs(obj.w), h: Math.abs(obj.h) };
}

function rectFromPoints(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function hitTest(point) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    const b = bounds(obj);
    if (point.x >= b.x - 10 && point.x <= b.x + b.w + 10 && point.y >= b.y - 10 && point.y <= b.y + b.h + 10) return obj;
  }
  return null;
}

function render() {
  drawBackground();
  state.objects.forEach(drawObject);
  const selected = state.objects.find(o => o.id === state.selected);
  if (selected) drawSelection(selected);
  updateInspector();
}

function updateInspector() {
  const info = document.getElementById('selectionInfo');
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) {
    info.className = 'empty';
    info.textContent = 'Nothing selected';
    return;
  }
  info.className = '';
  const b = bounds(obj);
  info.textContent = `${obj.type} · ${Math.round(b.w)} × ${Math.round(b.h)} at ${Math.round(b.x)}, ${Math.round(b.y)}`;
  controls.color.value = obj.color || controls.color.value;
  controls.fill.value = obj.fill || controls.fill.value;
  controls.size.value = obj.size || controls.size.value;
  controls.opacity.value = Math.round((obj.opacity ?? 1) * 100);
  controls.font.value = obj.font || controls.font.value;
  controls.bold.checked = !!obj.bold;
  controls.shadow.checked = !!obj.shadow;
  controls.depth.checked = !!obj.depth;
}

function createObject(point) {
  const base = { id: crypto.randomUUID(), ...styleFromControls() };
  if (state.tool === 'arrow') return { ...base, type: 'arrow', x: point.x, y: point.y, x2: point.x, y2: point.y };
  if (state.tool === 'rect' || state.tool === 'highlight' || state.tool === 'blur' || state.tool === 'pixelate' || state.tool === 'crop') {
    return { ...base, type: state.tool, x: point.x, y: point.y, w: 1, h: 1 };
  }
  if (state.tool === 'pen') return { ...base, type: 'pen', points: [point] };
  if (state.tool === 'icon') return { ...base, type: 'icon', x: point.x, y: point.y, stamp: state.stamp, size: Math.max(40, base.size) };
  if (state.tool === 'text') return { ...base, type: 'text', x: point.x, y: point.y, w: 290, h: 70, text: 'Double-click to edit' };
  return null;
}

function moveObject(obj, dx, dy) {
  obj.x += dx;
  obj.y += dy;
  if (obj.type === 'arrow') {
    obj.x2 += dx;
    obj.y2 += dy;
  }
  if (obj.type === 'pen') obj.points.forEach(p => { p.x += dx; p.y += dy; });
}

function editText(obj) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  textEditor.value = obj.text;
  textEditor.style.display = 'block';
  textEditor.style.left = `${canvas.offsetLeft + obj.x * scaleX}px`;
  textEditor.style.top = `${canvas.offsetTop + obj.y * scaleY}px`;
  textEditor.style.width = `${(obj.w || 290) * scaleX}px`;
  textEditor.style.height = `${(obj.h || 70) * scaleY}px`;
  textEditor.style.font = `${obj.bold ? 800 : 600} ${obj.size * scaleY}px ${obj.font}`;
  textEditor.style.color = obj.color;
  textEditor.focus();
  textEditor.onblur = () => {
    pushHistory();
    obj.text = textEditor.value;
    obj.w = Math.max(80, textEditor.offsetWidth / scaleX);
    obj.h = Math.max(36, textEditor.offsetHeight / scaleY);
    textEditor.style.display = 'none';
    render();
  };
}

canvas.addEventListener('pointerdown', evt => {
  const point = getPointer(evt);
  const hit = hitTest(point);

  if (state.tool === 'select') {
    const selected = state.objects.find(o => o.id === state.selected);
    const handle = resizeHandleAt(point, selected);
    if (selected && handle) {
      state.resize = {
        id: selected.id,
        handle,
        box: bounds(selected),
        original: JSON.parse(JSON.stringify(selected)),
        historyPushed: false,
      };
      canvas.setPointerCapture(evt.pointerId);
      return;
    }
    state.selected = hit?.id || null;
    if (hit) {
      state.drag = { id: hit.id, last: point, historyPushed: false };
      canvas.setPointerCapture(evt.pointerId);
    }
    render();
    return;
  }

  pushHistory();
  const obj = createObject(point);
  if (!obj) return;
  state.objects.push(obj);
  state.selected = obj.id;
  state.drawing = obj;
  if (state.tool === 'icon' || state.tool === 'text') {
    state.drawing = null;
    if (state.tool === 'text') setTimeout(() => editText(obj), 0);
  }
  render();
});

canvas.addEventListener('pointermove', evt => {
  const point = getPointer(evt);
  if (state.resize) {
    const obj = state.objects.find(o => o.id === state.resize.id);
    if (!obj) return;
    if (!state.resize.historyPushed) {
      pushHistory();
      state.resize.historyPushed = true;
    }
    resizeObject(obj, state.resize, point);
    render();
    return;
  }
  if (state.drag) {
    const obj = state.objects.find(o => o.id === state.drag.id);
    if (!obj) return;
    if (!state.drag.historyPushed) {
      pushHistory();
      state.drag.historyPushed = true;
    }
    moveObject(obj, point.x - state.drag.last.x, point.y - state.drag.last.y);
    state.drag.last = point;
    render();
    return;
  }
  const obj = state.drawing;
  if (!obj) {
    if (state.tool === 'select') {
      const selected = state.objects.find(o => o.id === state.selected);
      const handle = resizeHandleAt(point, selected);
      canvas.style.cursor = handle ? (handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize') : 'default';
    }
    return;
  }
  if (obj.type === 'arrow') {
    obj.x2 = point.x;
    obj.y2 = point.y;
  } else if (obj.type === 'pen') {
    obj.points.push(point);
  } else {
    obj.w = point.x - obj.x;
    obj.h = point.y - obj.y;
  }
  render();
});

canvas.addEventListener('pointerup', () => {
  if (state.drawing?.type === 'crop') {
    const crop = state.drawing;
    state.objects = state.objects.filter(o => o !== crop);
    state.selected = null;
    render();
    cropTo(crop);
  }
  state.drawing = null;
  state.drag = null;
  state.resize = null;
  render();
});

canvas.addEventListener('dblclick', evt => {
  const obj = hitTest(getPointer(evt));
  if (obj?.type === 'text') editText(obj);
});

function cropTo(obj) {
  const b = bounds(obj);
  if (b.w < 30 || b.h < 30) return;
  const tmp = document.createElement('canvas');
  tmp.width = b.w;
  tmp.height = b.h;
  tmp.getContext('2d').drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  state.bgData = tmp.toDataURL('image/png');
  const img = new Image();
  img.onload = () => {
    state.bgImage = img;
    resizeCanvas(img.width, img.height);
    render();
  };
  img.src = state.bgData;
  status('Canvas cropped.');
}

function applySelectedStyles() {
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  Object.assign(obj, styleFromControls());
  render();
}

Object.values(controls).forEach(control => control.addEventListener('input', applySelectedStyles));

document.getElementById('toolGrid').addEventListener('click', evt => {
  const btn = evt.target.closest('[data-tool]');
  if (btn) setTool(btn.dataset.tool);
});

document.getElementById('imageInput').addEventListener('change', evt => {
  const file = evt.target.files[0];
  if (file) loadImageFile(file);
});

window.addEventListener('paste', evt => {
  const item = [...evt.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (item) loadImageFile(item.getAsFile());
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    await saveCurrentToGallery({ silent: true });
    activeGalleryId = null;
    pushHistory();
    const img = new Image();
    img.onload = () => {
      state.bgData = reader.result;
      state.bgImage = img;
      resizeCanvas(img.width, img.height);
      state.objects = [];
      state.selected = null;
      status(`Loaded ${file.name || 'pasted image'}.`);
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function exportCanvas() {
  const imageData = captureCleanCanvas();
  const link = document.createElement('a');
  link.download = `skitch-studio-${Date.now()}.png`;
  link.href = imageData;
  link.click();
  saveImageToGallery(imageData, { silent: true });
  status('PNG exported and saved to the gallery.');
}

async function copyCanvas() {
  const imageData = captureCleanCanvas();
  try {
    const blob = await (await fetch(imageData)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    saveImageToGallery(imageData, { silent: true });
    status('PNG copied and saved to the gallery.');
  } catch {
    status('Clipboard copy is not available in this browser. Use Export PNG.');
  }
}

document.getElementById('exportBtn').addEventListener('click', exportCanvas);
document.getElementById('copyBtn').addEventListener('click', copyCanvas);
document.getElementById('demoBtn').addEventListener('click', makeDemo);
document.getElementById('saveGalleryBtn').addEventListener('click', () => saveCurrentToGallery());
document.getElementById('clearGalleryBtn').addEventListener('click', async () => {
  if (!galleryEntries.length || !confirm('Remove all saved images from this browser?')) return;
  try {
    await clearGalleryEntries();
    galleryEntries = [];
    activeGalleryId = null;
    renderGallery();
    status('Gallery cleared.');
  } catch {
    status('The gallery could not be cleared.');
  }
});

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!state.history.length) return;
  state.redo.push(JSON.stringify({ objects: state.objects, bgData: state.bgData }));
  restore(state.history.pop());
});

document.getElementById('redoBtn').addEventListener('click', () => {
  if (!state.redo.length) return;
  state.history.push(JSON.stringify({ objects: state.objects, bgData: state.bgData }));
  restore(state.redo.pop());
});

document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
document.addEventListener('keydown', evt => {
  if ((evt.key === 'Delete' || evt.key === 'Backspace') && document.activeElement !== textEditor) deleteSelected();
  if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'z') document.getElementById(evt.shiftKey ? 'redoBtn' : 'undoBtn').click();
});

function deleteSelected() {
  if (!state.selected) return;
  pushHistory();
  state.objects = state.objects.filter(o => o.id !== state.selected);
  state.selected = null;
  render();
}

document.getElementById('duplicateBtn').addEventListener('click', () => {
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  pushHistory();
  const copy = JSON.parse(JSON.stringify(obj));
  copy.id = crypto.randomUUID();
  moveObject(copy, 24, 24);
  state.objects.push(copy);
  state.selected = copy.id;
  render();
});

document.getElementById('bringForwardBtn').addEventListener('click', () => {
  const i = state.objects.findIndex(o => o.id === state.selected);
  if (i < 0 || i === state.objects.length - 1) return;
  pushHistory();
  [state.objects[i], state.objects[i + 1]] = [state.objects[i + 1], state.objects[i]];
  render();
});

document.getElementById('sendBackBtn').addEventListener('click', () => {
  const i = state.objects.findIndex(o => o.id === state.selected);
  if (i <= 0) return;
  pushHistory();
  [state.objects[i], state.objects[i - 1]] = [state.objects[i - 1], state.objects[i]];
  render();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  pushHistory();
  state.objects = [];
  state.selected = null;
  render();
});

controls.bg.addEventListener('change', () => {
  stage.classList.remove('white', 'dark');
  if (controls.bg.value !== 'checker') stage.classList.add(controls.bg.value);
});

initStamps();
renderGallery();
loadGallery();
makeDemo(false);
