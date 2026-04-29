const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Addon natif Windows (OLE drag + drop target)
let shellUtils = null;
try { shellUtils = require('./native/build/Release/shell_utils'); } catch { shellUtils = null; }
function guessMime(p) {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.avif': return 'image/avif';
    case '.ico': return 'image/x-icon';
    default: return null;
  }
}

const isFenceWindow = process.argv.some(a => typeof a === 'string' && a.startsWith('--fence-id='));

// APIs communes (utiles dans manager et fences)
const apiCommon = {
  // Version de l'application
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Drag natif vers le bureau / explorateur Windows
  nativeDragStart: (filePaths, fenceId) =>
    ipcRenderer.invoke('native-drag-start', { filePaths, fenceId }),

  // Win32: classe de la fenêtre sous le curseur (pour choisir la stratégie de drag)
  getWindowClassUnderCursor: () => {
    try { return shellUtils?.getWindowClassUnderCursor?.() ?? null; } catch { return null; }
  },

  // Paramètres fence (utiles aussi dans le manager)
  setFenceIconSize: (fenceId, iconSize) =>
    ipcRenderer.invoke('set-fence-icon-size', { fenceId, iconSize }),
};

const apiManager = {
  // Manager APIs
  listAllFences: () => ipcRenderer.invoke('list-all-fences'),
  createNewFence: (name) => ipcRenderer.invoke('create-new-fence', name),
  openFence: (fenceId) => ipcRenderer.invoke('open-fence', fenceId),
  deleteFence: (fenceId) => ipcRenderer.invoke('delete-fence', fenceId),
  managerMinimize: () => ipcRenderer.invoke('manager-minimize'),
  managerToggleMaximize: () => ipcRenderer.invoke('manager-toggle-maximize'),
  managerClose: () => ipcRenderer.invoke('manager-close'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Démarrage automatique avec Windows
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enable) => ipcRenderer.invoke('set-autostart', enable),
};

const apiFence = {
  // Fence APIs
  getCurrentFenceId: () => ipcRenderer.invoke('get-current-fence-id'),
  getFenceInfo: (fenceId) => ipcRenderer.invoke('get-fence-info', fenceId),
  setFenceName: (fenceId, newName) => ipcRenderer.invoke('set-fence-name', { fenceId, newName }),
  setFenceStyle: (fenceId, color, opacity) => ipcRenderer.invoke('set-fence-style', { fenceId, color, opacity }),
  setFenceIconSize: (fenceId, iconSize) => ipcRenderer.invoke('set-fence-icon-size', { fenceId, iconSize }),

  // Fence actions
  copyToFence: (fenceId, fullPath, name) =>
    ipcRenderer.invoke('copy-to-fence', { fenceId, srcFullPath: fullPath, destName: name }),
  listFenceItems: (fenceId) => ipcRenderer.invoke('list-fence-items', fenceId),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke('reveal-in-folder', filePath),
  renameInFence: (oldFullPath, newName) =>
    ipcRenderer.invoke('rename-in-fence', { oldFullPath, newName }),
  deleteFromFence: (fullPath) => ipcRenderer.invoke('delete-from-fence', fullPath),

  // Miniatures natives
  getFilePreview: (filePath) => ipcRenderer.invoke('get-file-preview', filePath),
  readImageAsDataURL: (filePath) => ipcRenderer.invoke('read-image-as-dataurl', filePath),
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
  getFileIconLarge: (filePath) => ipcRenderer.invoke('get-file-icon-large', filePath),
  getUrlFromFile: (filePath) => ipcRenderer.invoke('get-url-from-file', filePath),

  resizeBy: (type, dx, dy) => ipcRenderer.invoke('resize-by', type, dx, dy),
  resizeEnd: () => ipcRenderer.invoke('resize-end'),
  getFileStat: (filePath) => ipcRenderer.invoke('get-file-stat', filePath),
  trashItem: (filePath) => ipcRenderer.invoke('trash-item', filePath),

  // Drag & drop inter-fences
  fenceDragStart: (filePaths, fenceId) =>
    ipcRenderer.invoke('fence-drag-start', { filePaths, fenceId }),
  fenceDragDrop: (targetFenceId) =>
    ipcRenderer.invoke('fence-drag-drop', { targetFenceId }),
  fenceDragCancel: () => ipcRenderer.invoke('fence-drag-cancel'),
  isInterFenceDrag: () => ipcRenderer.invoke('is-inter-fence-drag'),
  dragDroppedOnDesktop: () => ipcRenderer.invoke('drag-dropped-on-desktop'),

  // OLE drag (source) : CF_HDROP + format interne BoxesInternalDrag
  startOleDrag: (filePaths, sourceFenceId) => {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    // Démarrer depuis le preload (renderer process). DoDragDrop est modal mais
    // possède son message pump OLE. On évite ainsi de faire crasher le main.
    const internal = [String(sourceFenceId || ''), ...paths].join('\n');
    if (!shellUtils?.startFileDrag) return Promise.resolve(0);
    try {
      const effect = shellUtils.startFileDrag(paths, internal);
      return Promise.resolve(effect || 0);
    } catch {
      return Promise.resolve(0);
    }
  },

  // Extraire un fichier vers le bureau (copie ou déplacement)
  extractToDesktop: (filePath, move) => ipcRenderer.invoke('extract-to-desktop', { filePath, move }),

  // Auto-organisation bureau
  getAutoOrganizeDesktop: () => ipcRenderer.invoke('get-auto-organize-desktop'),
  setAutoOrganizeDesktop: (enable) => ipcRenderer.invoke('set-auto-organize-desktop', enable),
  moveOriginalToBoxFolder: (srcFullPath, fenceId) =>
    ipcRenderer.invoke('move-original-to-box-folder', { srcFullPath, fenceId }),

  // Écrire un buffer brut dans la fence
  writeBufferToFence: (fenceId, destName, buffer) =>
    ipcRenderer.invoke('write-buffer-to-fence', { fenceId, destName, buffer }),

  // Events
  onFenceRefresh: (cb) => ipcRenderer.on('fence-refresh', cb),
  onIconSizeChanged: (cb) => ipcRenderer.on('icon-size-changed', (_evt, size) => cb(size)),
  setFenceShowExtensions: (fenceId, showExtensions) =>
    ipcRenderer.invoke('set-fence-show-extensions', { fenceId, showExtensions }),
  onShowExtensionsChanged: (cb) => ipcRenderer.on('show-extensions-changed', (_evt, val) => cb(val)),
  getFenceOrder: (fenceId) => ipcRenderer.invoke('get-fence-order', fenceId),
  setFenceOrder: (fenceId, order) => ipcRenderer.invoke('set-fence-order', { fenceId, order }),
  toggleRollup: (fenceId) => ipcRenderer.invoke('fence-toggle-rollup', fenceId),
  setFenceLocked: (fenceId, locked) => ipcRenderer.invoke('fence-set-locked', fenceId, locked),
  onLockedStateChanged: (cb) => ipcRenderer.on('locked-state-changed', (_evt, locked) => cb(locked)),
  cleanupDragPlaceholder: () => ipcRenderer.send('cleanup-drag-placeholder'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  setContentHeight: (height) => ipcRenderer.send('set-content-height', height),
  restoreLockedBounds: () => ipcRenderer.send('restore-locked-bounds'),
  onRolledStateChanged: (cb) => ipcRenderer.on('rolled-state-changed', (_evt, isRolled) => cb(isRolled)),

  // Icônes personnalisées
  setCustomIcon: (filePath, imageBuffer) =>
    ipcRenderer.invoke('set-custom-icon', { filePath, imageBuffer }),
  removeCustomIcon: (filePath) =>
    ipcRenderer.invoke('remove-custom-icon', filePath),
  pickIconFile: () =>
    ipcRenderer.invoke('pick-icon-file'),
  readFileAsBuffer: (filePath) =>
    ipcRenderer.invoke('read-file-as-buffer', filePath),
};

const api = isFenceWindow
  ? { ...apiCommon, ...apiFence }
  : { ...apiCommon, ...apiManager };

Object.freeze(api);
contextBridge.exposeInMainWorld('api', api);