const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

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

const api = {
  // Manager APIs
  listAllFences: () => ipcRenderer.invoke('list-all-fences'),
  createNewFence: (name) => ipcRenderer.invoke('create-new-fence', name),
  openFence: (fenceId) => ipcRenderer.invoke('open-fence', fenceId),
  deleteFence: (fenceId) => ipcRenderer.invoke('delete-fence', fenceId),
  managerMinimize: () => ipcRenderer.invoke('manager-minimize'),
  managerToggleMaximize: () => ipcRenderer.invoke('manager-toggle-maximize'),
  managerClose: () => ipcRenderer.invoke('manager-close'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  exportProfile: () => ipcRenderer.invoke('export-profile'),
  importProfile: () => ipcRenderer.invoke('import-profile'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Fence APIs
  getCurrentFenceId: () => ipcRenderer.invoke('get-current-fence-id'),
  getFenceInfo: (fenceId) => ipcRenderer.invoke('get-fence-info', fenceId),
  setFenceName: (fenceId, newName) => ipcRenderer.invoke('set-fence-name', { fenceId, newName }),
  setFenceStyle: (fenceId, color, opacity) => ipcRenderer.invoke('set-fence-style', { fenceId, color, opacity }),
  setFenceIconSize: (fenceId, iconSize) => ipcRenderer.invoke('set-fence-icon-size', { fenceId, iconSize }),
  
  // Fence actions (modifiées pour inclure fenceId)
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

  // Fallback Data URL (via IPC, plus de lecture directe fs)
  readImageAsDataURL: (filePath) => ipcRenderer.invoke('read-image-as-dataurl', filePath),

  // Icône système
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),

  // Icône système en grande taille (pour .lnk)
  getFileIconLarge: (filePath) => ipcRenderer.invoke('get-file-icon-large', filePath),

  // Obtenir l'URL depuis le main process
  getUrlFromFile: (filePath) => ipcRenderer.invoke('get-url-from-file', filePath),

  resizeBy: (type, dx, dy) => ipcRenderer.invoke('resize-by', type, dx, dy),
  resizeEnd: () => ipcRenderer.invoke('resize-end'),

  // Stat fichier (pour le tri par date)
  getFileStat: (filePath) => ipcRenderer.invoke('get-file-stat', filePath),

  // Corbeille
  trashItem: (filePath) => ipcRenderer.invoke('trash-item', filePath),

  // Drag & drop inter-fences
  fenceDragStart:  (filePaths, fenceId) => ipcRenderer.invoke('fence-drag-start', { filePaths: Array.isArray(filePaths) ? filePaths : [filePaths], fenceId }),
  fenceDragCancel: ()                  => ipcRenderer.invoke('fence-drag-cancel'),
  fenceDragDrop:   (targetFenceId)     => ipcRenderer.invoke('fence-drag-drop',   { targetFenceId }),
  isInterFenceDrag: ()                 => ipcRenderer.invoke('is-inter-fence-drag'),

  // Drag natif vers le bureau / explorateur Windows
  nativeDragStart: (filePaths) => ipcRenderer.invoke('native-drag-start', filePaths),

  // Extraire un fichier vers le bureau (copie ou déplacement)
  extractToDesktop: (filePath, move) => ipcRenderer.invoke('extract-to-desktop', { filePath, move }),

  // Auto-organisation bureau : déplacer l'original dans un dossier du nom de la box
  getAutoOrganizeDesktop: () => ipcRenderer.invoke('get-auto-organize-desktop'),
  setAutoOrganizeDesktop: (enable) => ipcRenderer.invoke('set-auto-organize-desktop', enable),
  moveOriginalToBoxFolder: (srcFullPath, fenceId) =>
    ipcRenderer.invoke('move-original-to-box-folder', { srcFullPath, fenceId }),

  // Écrire un buffer brut dans la fence (drop depuis navigateur web, f.path vide)
  writeBufferToFence: (fenceId, destName, buffer) =>
    ipcRenderer.invoke('write-buffer-to-fence', { fenceId, destName, buffer }),

  // Événement de rafraîchissement envoyé par le main process
  onFenceRefresh: (cb) => ipcRenderer.on('fence-refresh', cb),

  // Événement de changement de taille d'icône
  onIconSizeChanged: (cb) => ipcRenderer.on('icon-size-changed', (_evt, size) => cb(size)),

  // Affichage des extensions par box
  setFenceShowExtensions: (fenceId, showExtensions) =>
    ipcRenderer.invoke('set-fence-show-extensions', { fenceId, showExtensions }),
  onShowExtensionsChanged: (cb) => ipcRenderer.on('show-extensions-changed', (_evt, val) => cb(val)),

  // Ordre manuel des items
  getFenceOrder: (fenceId) => ipcRenderer.invoke('get-fence-order', fenceId),
  setFenceOrder: (fenceId, order) => ipcRenderer.invoke('set-fence-order', { fenceId, order }),

  // Dupliquer une fence
  duplicateFence: (fenceId) => ipcRenderer.invoke('duplicate-fence', fenceId),

  // Rollup — réduire une box à sa barre de titre
  toggleRollup: (fenceId) => ipcRenderer.invoke('fence-toggle-rollup', fenceId),

  // Verrouillage de position
  setFenceLocked: (fenceId, locked) => ipcRenderer.invoke('fence-set-locked', fenceId, locked),
  onLockedStateChanged: (cb) => ipcRenderer.on('locked-state-changed', (_evt, locked) => cb(locked)),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  setContentHeight: (height) => ipcRenderer.send('set-content-height', height),
  onRolledStateChanged: (cb) => ipcRenderer.on('rolled-state-changed', (_evt, isRolled) => cb(isRolled)),

  // Version de l'application
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Démarrage automatique avec Windows
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enable) => ipcRenderer.invoke('set-autostart', enable),

  // Icônes personnalisées (menu contextuel)
  setCustomIcon: (filePath, imageBuffer) =>
    ipcRenderer.invoke('set-custom-icon', { filePath, imageBuffer }),
  removeCustomIcon: (filePath) =>
    ipcRenderer.invoke('remove-custom-icon', filePath),
  pickIconFile: () =>
    ipcRenderer.invoke('pick-icon-file'),
  readFileAsBuffer: (filePath) =>
    ipcRenderer.invoke('read-file-as-buffer', filePath),
};

Object.freeze(api);
contextBridge.exposeInMainWorld('api', api);