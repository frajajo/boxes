// ============================================================================
// main.js — Version Multi-Boxes (VERSION FINALE, PROPRE, SANS DUPLICATION)
// ============================================================================

// ─────────────────────────────────────────────
// Imports principaux (tous regroupés ici)
// ─────────────────────────────────────────────
const path = require('path');
const fs = require("fs");
const { app, BrowserWindow, ipcMain, shell, nativeImage, screen, dialog, Tray, Menu, globalShortcut } = require('electron');
const { v4: uuidv4 } = require("uuid");
const { createCanvas } = require("canvas");

const os = require("os");
const crypto = require("crypto");

function debugLog() {}

const { pathToFileURL } = require("url");
const { autoUpdater } = require('electron-updater');

// ── Addon natif Windows ──
let shellUtils = null;
try {
  shellUtils = require('./native/build/Release/shell_utils');
} catch (e) {
  console.warn('[shell_utils] addon non disponible:', e.message);
}

// ─────────────────────────────────────────────
// Cache disque des icônes (PNG) — rapide + persistant
// ─────────────────────────────────────────────
const ICON_DISK_CACHE_DIR = path.join(app.getPath("userData"), "icon-cache");
const ICON_DISK_CACHE_VERSION = 12; // bump si tu changes la logique de rendu
const ICON_DISK_MAX_FILES = 3000;  // ajuste selon ton usage

function ensureDirSync(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { }
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function iconCacheKeyFromMeta(metaObj) {
  return sha1(JSON.stringify({ v: ICON_DISK_CACHE_VERSION, ...metaObj }));
}

function cachePngPathForKey(key) {
  return path.join(ICON_DISK_CACHE_DIR, `${key}.png`);
}

function toFileUrl(p) {
  return pathToFileURL(p).toString();
}

function pruneDiskCacheBestEffort() {
  try {
    ensureDirSync(ICON_DISK_CACHE_DIR);
    const files = fs.readdirSync(ICON_DISK_CACHE_DIR)
      .filter(f => f.toLowerCase().endsWith(".png"))
      .map(f => {
        const full = path.join(ICON_DISK_CACHE_DIR, f);
        const st = safeStat(full);
        return st ? { full, mtimeMs: st.mtimeMs } : null;
      })
      .filter(Boolean);

    if (files.length <= ICON_DISK_MAX_FILES) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const toDelete = files.slice(0, files.length - ICON_DISK_MAX_FILES);
    for (const it of toDelete) {
      try { fs.unlinkSync(it.full); } catch { }
    }
  } catch { }
}

async function writePngIfMissing(pngPath, pngBuffer) {
  try {
    if (fs.existsSync(pngPath)) return true;
    const tmp = pngPath + ".tmp";
    fs.writeFileSync(tmp, pngBuffer);
    fs.renameSync(tmp, pngPath);
    return true;
  } catch {
    return false;
  }
}

function dataUrlToBuffer(dataURL) {
  try {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataURL || "");
    if (!m) return null;
    return Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
}

// Convertit le résultat de shellUtils.getFileIconPng (buffer RGBA) en data URL
// Détecte la zone de contenu réelle et la recadre si elle est petite dans le canvas
function shellIconToDataURL(iconData, targetSize = 256) {
  if (!iconData || !iconData.data) return null;
  try {
    const { width, height, data } = iconData;

    // Canvas source avec les pixels bruts
    const src = createCanvas(width, height);
    const srcCtx = src.getContext('2d');
    const imgData = srcCtx.createImageData(width, height);
    imgData.data.set(data);
    srcCtx.putImageData(imgData, 0, 0);

    const dst = createCanvas(targetSize, targetSize);
    const dstCtx = dst.getContext('2d');

    // Trouver la bounding box du contenu opaque (seuil >100 pour ignorer l'anti-aliasing léger)
    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 100) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX >= minX && maxY >= minY) {
      const contentW = maxX - minX + 1;
      const contentH = maxY - minY + 1;
      if (contentW < width * 0.6 || contentH < height * 0.6) {
        dstCtx.drawImage(src, minX, minY, contentW, contentH, 0, 0, targetSize, targetSize);
      } else {
        dstCtx.drawImage(src, 0, 0, targetSize, targetSize);
      }
    } else {
      dstCtx.drawImage(src, 0, 0, targetSize, targetSize);
    }

    return dst.toDataURL('image/png');
  } catch { return null; }
}

async function getIconDataURLInternal(filePath, size) {

  const userIcon = getUserIconDataURL(filePath);
  if (userIcon) return userIcon;

  if (/\.lnk$/i.test(filePath)) {
    // Si le raccourci pointe vers un document Office/Adobe → icône doc haute qualité
    try {
      const sc = shell.readShortcutLink(filePath);
      const target = (sc.target || '').trim();
      if (target) {
        const docIcon = getDocIconByExt(path.extname(target));
        if (docIcon) return docIcon;
      }
    } catch { }
    const dataURL = await getLnkIcon(filePath);
    if (dataURL) return dataURL;
    try {
      const shortcut = shell.readShortcutLink(filePath);
      const target = (shortcut.target || '').trim();
      if (target && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        const icon = await app.getFileIcon(target, { size });
        if (icon && !icon.isEmpty()) return icon.toDataURL();
      }
    } catch { }
  } else if (/\.exe$/i.test(filePath)) {
    const custom = await tryGetCustomIcon({ lnkPath: filePath, targetPath: filePath });
    if (custom) return custom;
    const byPS = await extractIconPngViaPowerShell(filePath, 0);
    if (byPS) return byPS;
  } else {
    // Documents Office/Adobe : icône haute qualité avant app.getFileIcon
    const docIcon = getFileDocIcon(filePath);
    if (docIcon) return docIcon;
  }

  const icon = await app.getFileIcon(filePath, { size });
  if (!icon || icon.isEmpty()) return null;
  return icon.toDataURL();
}

async function getCachedIconURL(filePath, size = "normal") {
  ensureDirSync(ICON_DISK_CACHE_DIR);

  const st = safeStat(filePath);
  const isLnk = /\.lnk$/i.test(filePath);
  const meta = isLnk
    ? { s: size }  // ← pour les .lnk, la clé sera basée sur la CIBLE, pas le chemin du fichier
    : { p: filePath, s: size, m: st ? st.mtimeMs : 0, z: st ? st.size : 0 };

  if (/\.lnk$/i.test(filePath)) {
    try {
      const shortcut = shell.readShortcutLink(filePath);
      const target = (shortcut.target || "").trim();
      const iconPath = expandEnvVars((shortcut.icon || "").trim());
      const iconIndex = Number.isFinite(shortcut.iconIndex) ? shortcut.iconIndex : 0;


      meta.t = target;
      meta.i = iconPath;
      meta.x = iconIndex;

      const stT = target && fs.existsSync(target) ? safeStat(target) : null;
      if (stT) meta.tm = stT.mtimeMs;

      const stI = iconPath && fs.existsSync(iconPath) ? safeStat(iconPath) : null;
      if (stI) meta.im = stI.mtimeMs;
    } catch { }
  }

  const userIcon = getUserIconDataURL(filePath);
  if (userIcon) meta.u = sha1(userIcon);

  const key = iconCacheKeyFromMeta(meta);
  const pngPath = cachePngPathForKey(key);

  if (fs.existsSync(pngPath)) {
    try { fs.utimesSync(pngPath, new Date(), new Date()); } catch { }
    return toFileUrl(pngPath);
  }

  const dataURL = await getIconDataURLInternal(filePath, size);
  if (!dataURL) return null;

  let buf = null;
  if (/^data:image\/png;base64,/i.test(dataURL)) {
    buf = dataUrlToBuffer(dataURL);
  } else {
    try {
      const img = nativeImage.createFromDataURL(dataURL);
      if (img && !img.isEmpty()) buf = img.toPNG();
    } catch { }
  }

  if (buf && buf.length) {
    const ok = await writePngIfMissing(pngPath, buf);
    if (ok) return toFileUrl(pngPath);
  }

  return dataURL;
}
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
// ⚠️ Doit être appelé AVANT tout app.getPath('userData')
app.setPath('userData', path.join(app.getPath('appData'), 'Boxes'));
// Nécessaire pour que Windows associe la bonne icône dans la barre des tâches
app.setAppUserModelId('com.francoisfalik.boxes');

// ── Instance unique ─────────────────────────────────────────────────────────
// Empêche plusieurs instances et les zombies post-installation
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Une vraie instance tourne -> la mettre au premier plan et quitter
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Permet de fermer proprement l'instance existante depuis une 2e invocation:
    // `electron . --quit-now` (utilisé par `npm run stop`)
    if (Array.isArray(commandLine) && commandLine.includes('--quit-now')) {
      app.isQuitting = true;
      app.quit();
      return;
    }

    const allWins = BrowserWindow.getAllWindows();
    const mgr = allWins.find(w => { try { return w.getTitle().includes('Manager'); } catch { return false; } });
    if (mgr) { if (mgr.isMinimized()) mgr.restore(); mgr.focus(); }
  });
}


// Icône de l'application (barre des tâches + fenêtres)
const APP_ICON = (() => {
  const fss = require("fs");
  // process.resourcesPath = dossier resources/ de l installation
  // extraResources copie icon.ico dans resources/assets/icon.ico
  const p1 = path.join(process.resourcesPath, "assets", "icon.ico");
  if (fss.existsSync(p1)) return p1;
  // Fallback dev
  return path.join(__dirname, "assets", "icon.ico");
})();



const ICON_DIR = path.join(__dirname, 'assets', 'icons');

// ── Icônes personnalisées assignées par l'utilisateur ─────────────
// Stockées dans userData/custom-icons/<stem-minuscule>.png
// Survit aux mises à jour de l'application (contrairement à assets/)
const USER_ICON_DIR = path.join(
  require('electron').app.getPath('userData'),
  'custom-icons'
);
try { fs.mkdirSync(USER_ICON_DIR, { recursive: true }); } catch { }

// ─────────────────────────────────────────────
// Icônes de DOCUMENTS par extension (256×256, canvas)
// ─────────────────────────────────────────────
const DOC_ICON_DIR = path.join(app.getPath('userData'), 'doc-icons-v1');
try { fs.mkdirSync(DOC_ICON_DIR, { recursive: true }); } catch {}

const FILE_ICON_PRESETS = {
  '.doc':    { file: 'doc-word.png',  label: 'W',   bg: '#2B579A', sub: 'DOC'   },
  '.docx':   { file: 'doc-word.png',  label: 'W',   bg: '#2B579A', sub: 'DOCX'  },
  '.docm':   { file: 'doc-word.png',  label: 'W',   bg: '#2B579A', sub: 'DOCM'  },
  '.xls':    { file: 'doc-excel.png', label: 'X',   bg: '#217346', sub: 'XLS'   },
  '.xlsx':   { file: 'doc-excel.png', label: 'X',   bg: '#217346', sub: 'XLSX'  },
  '.xlsm':   { file: 'doc-excel.png', label: 'X',   bg: '#217346', sub: 'XLSM'  },
  '.xlsb':   { file: 'doc-excel.png', label: 'X',   bg: '#217346', sub: 'XLSB'  },
  '.csv':    { file: 'doc-csv.png',   label: 'X',   bg: '#217346', sub: 'CSV'   },
  '.ppt':    { file: 'doc-ppt.png',   label: 'P',   bg: '#B7472A', sub: 'PPT'   },
  '.pptx':   { file: 'doc-ppt.png',   label: 'P',   bg: '#B7472A', sub: 'PPTX'  },
  '.pptm':   { file: 'doc-ppt.png',   label: 'P',   bg: '#B7472A', sub: 'PPTM'  },
  '.pdf':    { file: 'doc-pdf.png',   label: 'PDF', bg: '#CC0000', sub: 'PDF'   },
  '.ai':     { file: 'doc-ai.png',    label: 'Ai',  bg: '#300000', sub: 'AI'    },
  '.psd':    { file: 'doc-psd.png',   label: 'Ps',  bg: '#001E36', sub: 'PSD'   },
  '.psb':    { file: 'doc-psd.png',   label: 'Ps',  bg: '#001E36', sub: 'PSB'   },
  '.indd':   { file: 'doc-indd.png',  label: 'Id',  bg: '#4A0C3D', sub: 'INDD'  },
  '.indt':   { file: 'doc-indd.png',  label: 'Id',  bg: '#4A0C3D', sub: 'INDT'  },
  '.aep':    { file: 'doc-ae.png',    label: 'Ae',  bg: '#1A0038', sub: 'AEP'   },
  '.prproj': { file: 'doc-pr.png',    label: 'Pr',  bg: '#1A0038', sub: 'PRPRJ' },
  '.eps':    { file: 'doc-eps.png',   label: 'EPS', bg: '#FF7900', sub: 'EPS'   },
};

function generateDocIconSync({ file, label, bg, sub }) {
  const full = path.join(DOC_ICON_DIR, file);
  if (fs.existsSync(full)) return full;
  try {
    const size = 256, r = 28;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F5F5F5';
    ctx.beginPath();
    ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.arcTo(size,0,size,r,r);
    ctx.lineTo(size,size-r); ctx.arcTo(size,size,size-r,size,r);
    ctx.lineTo(r,size); ctx.arcTo(0,size,0,size-r,r);
    ctx.lineTo(0,r); ctx.arcTo(0,0,r,0,r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.arcTo(size,0,size,r,r);
    ctx.lineTo(size,size*0.46); ctx.lineTo(0,size*0.46);
    ctx.lineTo(0,r); ctx.arcTo(0,0,r,0,r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    const fs2 = label.length===1?96:label.length===2?76:52;
    ctx.font = `bold ${fs2}px Arial`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label, size/2, size*0.23);
    ctx.fillStyle='#555'; ctx.font='bold 34px Arial';
    ctx.fillText(sub, size/2, size*0.73);
    ctx.fillStyle='#DDD'; ctx.fillRect(size*0.1, size*0.57, size*0.8, 2);
    fs.writeFileSync(full, canvas.toBuffer('image/png'));
    return full;
  } catch { return null; }
}

function getFileDocIcon(filePath) {
  const userIcon = getUserIconDataURL(filePath);
  if (userIcon) return userIcon;
  const ext = path.extname(filePath).toLowerCase();
  const preset = FILE_ICON_PRESETS[ext];
  if (!preset) return null;
  const full = generateDocIconSync(preset);
  if (!full) return null;
  const img = nativeImage.createFromPath(full);
  return (img && !img.isEmpty()) ? img.toDataURL() : null;
}

function getDocIconByExt(ext) {
  const preset = FILE_ICON_PRESETS[ext.toLowerCase()];
  if (!preset) return null;
  const full = generateDocIconSync(preset);
  if (!full) return null;
  const img = nativeImage.createFromPath(full);
  return (img && !img.isEmpty()) ? img.toDataURL() : null;
}


/** Chemin de l'icône utilisateur pour un fichier donné, ou null */
function getUserIconPath(filePath) {
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.ico']) {
    const p = path.join(USER_ICON_DIR, stem + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Data URL de l'icône utilisateur, ou null */
function getUserIconDataURL(filePath) {
  const p = getUserIconPath(filePath);
  if (!p) return null;
  try {
    const img = nativeImage.createFromPath(p);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch { return null; }
}

const ICON_PRESETS = {
  'WINWORD.EXE': { file: 'word.png', label: 'W', bg: '#2B579A' },
  'EXCEL.EXE': { file: 'excel.png', label: 'X', bg: '#217346' },
  'POWERPNT.EXE': { file: 'ppt.png', label: 'P', bg: '#B7472A' },
  'THORIUM.EXE': { file: 'thorium.png', label: 'T', bg: '#444444' },
  'IMPEROCONSOLE.EXE': { file: 'impero.png', label: 'I', bg: '#333333' },
  "PHOTOSHOP.EXE": { file: "ps.png", label: "Ps", bg: "#001E36" },
  "ILLUSTRATOR.EXE": { file: "ai.png", label: "Ai", bg: "#300000" }

};

// Correspondances AppUserModelId → preset
const ICON_PRESETS_AUMID = [
  { contains: 'WINWORD', file: 'word.png' },
  { contains: 'EXCEL', file: 'excel.png' },
  { contains: 'POWERPNT', file: 'ppt.png' },
  { contains: 'THORIUM', file: 'thorium.png' },
  { contains: 'IMPERO', file: 'impero.png' },
];

function getCustomIconForExe(exePath) {
  try {
    const exeName = path.basename(exePath).toUpperCase();
    const preset = ICON_PRESETS[exeName];
    if (!preset) return null;
    const p = path.join(ICON_DIR, preset.file);
    const img = nativeImage.createFromPath(p);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch { return null; }
}
// Génère un PNG 128x128 (tuile arrondie + label centré)
async function generateIconPngIfMissing({ file, label, bg }) {
  try {
    fs.mkdirSync(ICON_DIR, { recursive: true });
    const full = path.join(ICON_DIR, file);
    if (fs.existsSync(full)) return full; // déjà présent (ou remplacé par icône officielle)

    const size = 128;
    const radius = 22;

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    // Fond (tuile arrondie)
    ctx.fillStyle = bg;
    ctx.beginPath();
    roundedRect(ctx, 0, 0, size, size, radius);
    ctx.fill();

    // Lettre(s)
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 64px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, size / 2, size / 2 + 4);

    fs.writeFileSync(full, canvas.toBuffer("image/png"));
    return full;
  } catch (e) {
    console.warn("[custom-icons] generate failed", e);
    return null;
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// ─────────────────────────────────────────────
// PDF.js — Chargement compatible avec toutes les versions
// ─────────────────────────────────────────────
// PDF.js version 2.16.105 (CommonJS compatible)
let pdfjsLib = null;
try {
  pdfjsLib = require("pdfjs-dist/build/pdf.js");
  console.log("PDFJS chargé !");
} catch (e) {
  console.error("❌ Erreur chargement PDFJS :", e);
}


// Miniature PDF via PDF.js
async function getPdfThumbnail(filePath) {
  try {
    if (!pdfjsLib) return null;

    const loadingTask = pdfjsLib.getDocument(filePath);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const scale = 0.25;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    const png = canvas.toBuffer("image/png");
    return "data:image/png;base64," + png.toString("base64");
  } catch (e) {
    console.error("[pdfjs thumbnail error]", e);
    return null;
  }
}

// ─────────────────────────────────────────────
// Dossiers et états globaux
// ─────────────────────────────────────────────
const FENCES_BASE_DIR = path.join(app.getPath("userData"), "fences");
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const TITLE_HEIGHT = 32; // hauteur de la barre de titre (28px + bordures)
const FENCE_MIN_W = 160;  // largeur minimale d'une fence

// États
const openFences = new Map();
let draggedItem = null;
let lastDragPlaceholderBaseName = null; // basename du placeholder startDrag courant (inter-box / bureau)
let lastDragPlaceholderPath = null; // chemin complet du placeholder (inter-box)
let _desktopDropPollTimer = null;
let _lastNativeDragStartAt = 0;
let _lastDesktopDetectAt = 0;

// ── OLE DropTarget → handlers (inter-box + fichiers externes) ────────────────
async function movePathsBetweenFences(filePaths, sourceFenceId, targetFenceId) {
  if (!Array.isArray(filePaths) || !filePaths.length) return false;
  if (!isValidFenceId(sourceFenceId) || !isValidFenceId(targetFenceId)) return false;
  if (sourceFenceId === targetFenceId) return false;

  const targetDir = path.join(FENCES_BASE_DIR, targetFenceId);
  fs.mkdirSync(targetDir, { recursive: true });

  let moved = 0;
  for (const fp of filePaths) {
    try {
      const p = path.normalize(fp);
      if (!isPathInFences(p)) continue;
      const fileName = path.basename(p);
      const dest = ensureUniqueDest(path.join(targetDir, fileName));
      await fs.promises.rename(p, dest);
      moved++;
    } catch {}
  }

  if (openFences.has(sourceFenceId)) openFences.get(sourceFenceId).webContents.send("fence-refresh");
  if (openFences.has(targetFenceId)) openFences.get(targetFenceId).webContents.send("fence-refresh");
  return moved > 0;
}

async function copyExternalPathsToFence(filePaths, targetFenceId) {
  if (!Array.isArray(filePaths) || !filePaths.length) return false;
  if (!isValidFenceId(targetFenceId)) return false;

  const dir = path.join(FENCES_BASE_DIR, targetFenceId);
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;

  for (const fp of filePaths) {
    try {
      if (!fp || typeof fp !== "string") continue;
      if (!fs.existsSync(fp)) continue;
      const destName = sanitizeFileName(path.basename(fp));
      const destPath = ensureUniqueDest(path.join(dir, destName));
      const st = fs.lstatSync(fp);
      if (st.isDirectory()) {
        await fs.promises.cp(fp, destPath, { recursive: true });
      } else {
        try {
          await fs.promises.copyFile(fp, destPath);
        } catch {
          await streamCopy(fp, destPath);
        }
      }
      copied++;
    } catch {}
  }

  if (openFences.has(targetFenceId)) openFences.get(targetFenceId).webContents.send("fence-refresh");
  return copied > 0;
}

function attachOleDropTargetToFenceWindow(win, fenceId) {
  if (!shellUtils?.registerDropTarget || !shellUtils?.revokeDropTarget) return;
  try {
    const handle = win.getNativeWindowHandle(); // Buffer
    const ok = shellUtils.registerDropTarget(handle, async (payload) => {
      try {
        if (!payload || typeof payload !== "object") return;
        if (payload.kind === "internal" && typeof payload.internal === "string") {
          const lines = payload.internal.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const sourceFenceId = lines.shift();
          const paths = lines;
          await movePathsBetweenFences(paths, sourceFenceId, fenceId);
          return;
        }
        if (payload.kind === "files" && Array.isArray(payload.files)) {
          await copyExternalPathsToFence(payload.files, fenceId);
        }
      } catch {}
    });
    if (!ok) {
      try { console.warn("[ole-drop-target] register failed for fence", fenceId); } catch {}
      return;
    }
    win.on('closed', () => {
      try { shellUtils.revokeDropTarget(handle); } catch {}
    });
  } catch {}
}

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

function ensureBaseDir() {
  try {
    fs.mkdirSync(FENCES_BASE_DIR, { recursive: true });
  } catch (e) {
    console.error("[fences] mkdir failed", e);
  }
}

function readConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(data);
    return validateConfig(cfg);
  } catch {
    return { fences: [] };
  }
}

function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
  } catch (e) {
    console.error("[config] write failed", e);
  }
}

// ─────────────────────────────────────────────
// SÉCURITÉ — Validation des chemins et entrées
// ─────────────────────────────────────────────

/** Vérifie qu'un chemin normalisé est bien contenu dans un répertoire parent */
function isPathInside(childPath, parentPath) {
  const child = path.resolve(path.normalize(childPath));
  const parent = path.resolve(path.normalize(parentPath));
  return child.toLowerCase().startsWith(parent.toLowerCase() + path.sep) ||
    child.toLowerCase() === parent.toLowerCase();
}

/** Vérifie que le chemin est dans le dossier fences */
function isPathInFences(filePath) {
  return isPathInside(filePath, FENCES_BASE_DIR);
}

/** Vérifie que le chemin est sur le bureau */
function isPathOnDesktop(filePath) {
  try {
    return isPathInside(filePath, app.getPath("desktop"));
  } catch { return false; }
}

/** Vérifie qu'un fenceId est un UUID v4 valide */
function isValidFenceId(fenceId) {
  return typeof fenceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fenceId);
}

/** Vérifie que le fenceId existe dans la config */
function fenceExists(fenceId) {
  if (!isValidFenceId(fenceId)) return false;
  const cfg = readConfig();
  return cfg.fences.some(f => f.id === fenceId);
}

/** Nettoie un nom de fichier (supprime traversals et caractères interdits) */
function sanitizeFileName(name) {
  if (typeof name !== 'string') return 'fichier';
  // Supprimer tout chemin relatif/absolu
  let clean = name.replace(/^.*[\\/]/, '');
  // Supprimer les caractères interdits Windows
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  // Empêcher les noms réservés Windows
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(clean)) {
    clean = '_' + clean;
  }
  // Pas de nom vide
  return clean.trim() || 'fichier';
}

/** Valide la structure de la config (schéma minimal) */
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { fences: [] };
  if (!Array.isArray(cfg.fences)) cfg.fences = [];
  // Filtrer les fences invalides
  cfg.fences = cfg.fences.filter(f =>
    f && typeof f === 'object' &&
    typeof f.id === 'string' &&
    isValidFenceId(f.id) &&
    typeof f.name === 'string'
  );
  return cfg;
}

// ─────────────────────────────────────────────
// CRÉATION FENCE
// ─────────────────────────────────────────────

function createFence(fenceId, fenceName) {
  const fenceDir = path.join(FENCES_BASE_DIR, fenceId);
  try {
    fs.mkdirSync(fenceDir, { recursive: true });
  } catch { }

  const cfg = readConfig();
  let fenceConfig = cfg.fences.find((f) => f.id === fenceId);

  if (!fenceConfig) {
    fenceConfig = {
      id: fenceId,
      name: fenceName || "Nouvelle Fence",
      bounds: { width: 480, height: 360, x: 100, y: 100 },
    };
    cfg.fences.push(fenceConfig);
    writeConfig(cfg);
  }

  const isRolledOnStart = fenceConfig.rolled ?? false;

  const win = new BrowserWindow({
    width: fenceConfig.bounds?.width ?? 480,
    height: isRolledOnStart ? TITLE_HEIGHT : (fenceConfig.bounds?.height ?? 360),
    x: fenceConfig.bounds?.x,
    y: fenceConfig.bounds?.y,
    minWidth: FENCE_MIN_W,
    minHeight: isRolledOnStart ? TITLE_HEIGHT : 80,
    transparent: true,
    frame: false,
    resizable: true,
    maximizable: false,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    title: fenceConfig.name,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      additionalArguments: [`--fence-id=${fenceId}`],
    },
  });

  // Activer le drop OLE sur cette box (inter-box + drop Explorer)
  attachOleDropTargetToFenceWindow(win, fenceId);

  // Sécurité navigation : aucune ouverture/navigations externes depuis le renderer.
  // (deny-by-default)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    // Autoriser uniquement les navigations vers nos fichiers locaux.
    // Tout le reste est bloqué.
    try {
      if (!url || typeof url !== 'string') { e.preventDefault(); return; }
      if (url.startsWith('file:')) return;
    } catch {}
    e.preventDefault();
  });

  // sauvegarde position/taille
  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const b = win.getBounds();
        const cfg = readConfig();
        const f = cfg.fences.find((f) => f.id === fenceId);
        if (f) {
          // Si la box est roulée, ne pas écraser bounds.height avec la hauteur réduite
          if (f.rolled) {
            f.bounds = { ...b, height: f.unrolledHeight ?? f.bounds?.height ?? 360 };
          } else {
            f.bounds = b;
          }
          writeConfig(cfg);
        }
      } catch { }
    }, 300);
  };

  // Position de référence quand la fence est verrouillée
  let lockedBounds = null;
  let lockSuspended = false;

  win.on("move", () => {
    if (lockedBounds && !lockSuspended) {
      win.setBounds(lockedBounds);
      return;
    }
    if (!lockedBounds) queueSave();
  });

  win.on("resize", () => {
    if (lockedBounds && !lockSuspended) {
      win.setBounds(lockedBounds);
      return;
    }
    if (!lockedBounds) queueSave();
  });

  // Exposer lockedBounds pour le handler IPC fence-set-locked
  win._lockedBounds = () => lockedBounds;
  win._setLockedBounds = (b) => { lockedBounds = b; };
  win._suspendLock = () => { lockSuspended = true; };
  win._clearLockSuspend = () => { lockSuspended = false; };
  win._resumeLock = () => {
    lockSuspended = false;
    if (lockedBounds) win.setBounds(lockedBounds);
  };

  win.on("close", () => {
    try {
      const b = win.getBounds();
      const cfg = readConfig();
      const f = cfg.fences.find((f) => f.id === fenceId);
      if (f) {
        if (f.rolled) {
          f.bounds = { ...b, height: f.unrolledHeight ?? f.bounds?.height ?? 360 };
        } else {
          f.bounds = b;
        }
        writeConfig(cfg);
      }
    } catch { }
    openFences.delete(fenceId);
  });

  win.loadFile("fence.html");
  win.once("ready-to-show", () => { try { win.setIcon(APP_ICON); } catch {} });
  win.webContents.once('did-finish-load', () => {
    if (isRolledOnStart) {
      win.webContents.send('rolled-state-changed', true);
    }
    if (fenceConfig.locked) {
      win._setLockedBounds(win.getBounds());
      win.webContents.send('locked-state-changed', true);
    }
  });
  openFences.set(fenceId, win);
  return win;
}

// ─────────────────────────────────────────────
// MANAGER
// ─────────────────────────────────────────────

function createManager() {
  const cfg = readConfig();
  const mb = cfg.managerBounds || {};

  const win = new BrowserWindow({
    width: mb.width ?? 300,
    height: mb.height ?? 400,
    x: mb.x,
    y: mb.y,
    minWidth: 280,
    minHeight: 300,
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    title: "Fence Manager",
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Sécurité navigation : aucune ouverture/navigations externes depuis le renderer.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    try {
      if (!url || typeof url !== 'string') { e.preventDefault(); return; }
      if (url.startsWith('file:')) return;
    } catch {}
    e.preventDefault();
  });

  win.loadFile("manager.html");
  win.once("ready-to-show", () => { try { win.setIcon(APP_ICON); app.setIcon && app.setIcon(APP_ICON); } catch { } });

  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const b = win.getBounds();
        const cfg = readConfig();
        cfg.managerBounds = b;
        writeConfig(cfg);
      } catch { }
    }, 300);
  };

  win.on("move", queueSave);
  win.on("resize", queueSave);
  win.on("close", queueSave);

  return win;
}

// ============================================================================
// ████  IPC SECTION  — TOUTES LES ACTIONS
// ============================================================================

// ─────────────────────────────────────────────
// MANAGER
// ─────────────────────────────────────────────

ipcMain.on('move-window', (evt, dx, dy) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

ipcMain.on('set-content-height', (evt, height) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win || win.isDestroyed()) return;
  // Ne pas auto-redimensionner si la fence est enroulée
  const fenceId = [...openFences.entries()].find(([, w]) => w === win)?.[0];
  if (fenceId) {
    const cfg = readConfig();
    const f = cfg.fences.find(x => x.id === fenceId);
    if (f?.rolled) return;
    if (f?.locked) {
      // Suspendre le verrou le temps d'afficher le panel
      win._suspendLock?.();
      const newH = Math.max(TITLE_HEIGHT, Math.round(height));
      const b = win.getBounds();
      win.setMinimumSize(FENCE_MIN_W, TITLE_HEIGHT);
      win.setResizable(false);
      win.setBounds({ x: b.x, y: b.y, width: b.width + 1, height: newH }, false);
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: newH }, false);
      win.setResizable(true);
      win.setMinimumSize(FENCE_MIN_W, newH);
      setTimeout(() => { win._clearLockSuspend?.(); }, 50);
      return;
    }
  }
  const newH = Math.max(TITLE_HEIGHT, Math.round(height));
  const b = win.getBounds();
  // DWM trick : déverrouiller le minimum avant de réduire
  win.setMinimumSize(FENCE_MIN_W, TITLE_HEIGHT);
  win.setResizable(false);
  win.setBounds({ x: b.x, y: b.y, width: b.width + 1, height: newH }, false);
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: newH }, false);
  win.setResizable(true);
  win.setMinimumSize(FENCE_MIN_W, newH);
});

ipcMain.on('restore-locked-bounds', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win || win.isDestroyed()) return;
  win._resumeLock?.();
});

ipcMain.handle("manager-minimize", (evt) => {
  BrowserWindow.fromWebContents(evt.sender)?.minimize();
});

ipcMain.handle("manager-toggle-maximize", (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.handle("manager-close", (evt) => {
  // Masquer le manager (l'app continue dans le tray)
  BrowserWindow.fromWebContents(evt.sender)?.hide();
});

ipcMain.handle("quit-app", () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle("list-all-fences", () => {
  const cfg = readConfig();
  return cfg.fences || [];
});

ipcMain.handle("create-new-fence", (_evt, name) => {
  const fenceId = uuidv4();
  const fenceName = (name || "").trim() || "Nouvelle Fence";
  createFence(fenceId, fenceName);
  return { id: fenceId, name: fenceName };
});

ipcMain.handle("open-fence", (_evt, fenceId) => {
  if (openFences.has(fenceId)) {
    const win = openFences.get(fenceId);
    win.show();
    win.focus();
    return true;
  }

  const cfg = readConfig();
  const fence = cfg.fences.find((f) => f.id === fenceId);

  if (fence) {
    createFence(fenceId, fence.name);
    return true;
  }

  return false;
});

ipcMain.handle("delete-fence", async (_evt, fenceId) => {
  try {
    if (openFences.has(fenceId)) openFences.get(fenceId).close();

    const dir = path.join(FENCES_BASE_DIR, fenceId);
    if (fs.existsSync(dir)) await shell.trashItem(dir);

    const cfg = readConfig();
    cfg.fences = cfg.fences.filter((f) => f.id !== fenceId);
    writeConfig(cfg);

    return true;
  } catch (e) {
    console.error("[delete-fence] failed", e);
    return false;
  }
});

// ─────────────────────────────────────────────
// FENCE INFO
// ─────────────────────────────────────────────

ipcMain.handle("get-current-fence-id", (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  for (const [id, w] of openFences.entries()) {
    if (w === win) return id;
  }
  return null;
});

ipcMain.handle("get-fence-info", (_evt, fenceId) => {
  const cfg = readConfig();
  return cfg.fences.find((f) => f.id === fenceId) || null;
});

ipcMain.handle("set-fence-style", (_evt, { fenceId, color, opacity }) => {
  const cfg = readConfig();
  const f = cfg.fences.find((x) => x.id === fenceId);
  if (f) {
    f.style = { color: color || "#1e1e1e", opacity: opacity ?? 0.6 };
    writeConfig(cfg);
  }
  return f?.style ?? null;
});

ipcMain.handle("set-fence-name", (_evt, { fenceId, newName }) => {
  const name = String(newName || "").trim() || "Fence";
  const cfg = readConfig();
  const f = cfg.fences.find((x) => x.id === fenceId);

  if (f) {
    f.name = name;
    writeConfig(cfg);
    if (openFences.has(fenceId)) openFences.get(fenceId).setTitle(name);
  }

  return name;
});

ipcMain.handle("set-fence-icon-size", (_evt, { fenceId, iconSize }) => {
  const VALID = [32, 48, 128, 256];
  const size = VALID.includes(iconSize) ? iconSize : 48;
  const cfg = readConfig();
  const f = cfg.fences.find((x) => x.id === fenceId);
  if (f) {
    f.iconSize = size;
    writeConfig(cfg);
    if (openFences.has(fenceId)) {
      const win = openFences.get(fenceId);
      const send = () => {
        win.webContents.send("icon-size-changed", size);
      };
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    } else {
      // fence non ouverte, rien à faire
    }
  }
  return f?.iconSize ?? 48;
});

ipcMain.handle("set-fence-show-extensions", (_evt, { fenceId, showExtensions }) => {
  const cfg = readConfig();
  const f = cfg.fences.find((x) => x.id === fenceId);
  if (f) {
    f.showExtensions = !!showExtensions;
    writeConfig(cfg);
    if (openFences.has(fenceId)) {
      const win = openFences.get(fenceId);
      const send = () => win.webContents.send("show-extensions-changed", !!showExtensions);
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    }
  }
  return f?.showExtensions ?? false;
});

// ─────────────────────────────────────────────
// LIST ITEMS
// ─────────────────────────────────────────────

ipcMain.handle("list-fence-items", (_evt, fenceId) => {
  try {
    if (!isValidFenceId(fenceId)) return [];
    const dir = path.join(FENCES_BASE_DIR, fenceId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
});

// ─────────────────────────────────────────────
// UTILS COPY
// ─────────────────────────────────────────────

function ensureUniqueDest(dest) {
  const { dir, name, ext } = path.parse(dest);
  let final = dest;
  let i = 1;

  while (fs.existsSync(final)) {
    final = path.join(dir, `${name} (${i})${ext}`);
    i++;
  }

  return final;
}

function streamCopy(src, dest) {
  return new Promise((resolve, reject) => {
    const r = fs.createReadStream(src);
    const w = fs.createWriteStream(dest);
    r.on("error", reject);
    w.on("error", reject);
    w.on("finish", resolve);
    r.pipe(w);
  });
}

ipcMain.handle("copy-to-fence", async (_evt, { fenceId, srcFullPath, destName }) => {
  try {
    if (!isValidFenceId(fenceId)) throw new Error("Invalid fenceId");
    const safeName = sanitizeFileName(destName);

    const dir = path.join(FENCES_BASE_DIR, fenceId);
    fs.mkdirSync(dir, { recursive: true });

    // Si le fichier source est déjà dans cette fence, ne rien faire
    const srcNorm = path.normalize(srcFullPath);
    const dirNorm = path.normalize(dir);
    if (srcNorm.startsWith(dirNorm + path.sep)) {
      return srcFullPath; // déjà là, on ignore silencieusement
    }

    let destPath = ensureUniqueDest(path.join(dir, safeName));
    const st = fs.lstatSync(srcFullPath);

    if (st.isDirectory()) {
      await fs.promises.cp(srcFullPath, destPath, { recursive: true });
    } else {
      try {
        await fs.promises.copyFile(srcFullPath, destPath);
      } catch {
        await streamCopy(srcFullPath, destPath);
      }
    }

    return destPath;
  } catch (e) {
    console.error("[copy-to-fence] failed", e);
    throw e;
  }
});

ipcMain.handle("write-buffer-to-fence", async (_evt, { fenceId, destName, buffer }) => {
  try {
    if (!isValidFenceId(fenceId)) throw new Error("Invalid fenceId");
    const safeName = sanitizeFileName(destName);

    const dir = path.join(FENCES_BASE_DIR, fenceId);
    fs.mkdirSync(dir, { recursive: true });
    const destPath = ensureUniqueDest(path.join(dir, safeName));
    const buf = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
    fs.writeFileSync(destPath, buf);
    return destPath;
  } catch (e) {
    console.error("[write-buffer-to-fence] failed", e);
    throw e;
  }
});

// ============================================================================
// MINIATURES (PDF + IMAGES + ADOBE)
// ============================================================================

// ── Lecture du thumbnail JPEG embarqué dans un PSD (Resource ID 0x040C)
// Fonctionne sans dépendance externe : Photoshop intègre toujours ce JPEG
function extractPsdThumbnailBuffer(psdBuffer) {
  try {
    // Vérifier signature PSD/PSB
    const sig = psdBuffer.slice(0, 4).toString('ascii');
    if (sig !== '8BPS') return null;

    // Sauter l'en-tête fixe (26 octets) + Color Mode Data
    let offset = 26;
    const colorModeLen = psdBuffer.readUInt32BE(offset);
    offset += 4 + colorModeLen;

    // Parcourir les Image Resources
    const imgResLen = psdBuffer.readUInt32BE(offset);
    offset += 4;
    const imgResEnd = offset + imgResLen;

    while (offset < imgResEnd - 7) {
      const marker = psdBuffer.slice(offset, offset + 4).toString('ascii');
      if (marker !== '8BIM') break;
      offset += 4;

      const resourceId = psdBuffer.readUInt16BE(offset);
      offset += 2;

      // Pascal string (longueur + bytes, paddé sur 2)
      const nameLen = psdBuffer[offset];
      offset += 1 + nameLen;
      if ((nameLen + 1) % 2 !== 0) offset += 1; // padding

      const dataLen = psdBuffer.readUInt32BE(offset);
      offset += 4;

      // Resource 0x040C = thumbnail
      if (resourceId === 0x040C && dataLen > 28) {
        // Format : 4 octets format (1=JPEG), 4 w, 4 h, ... 4 dataLen, puis JPEG
        const fmt = psdBuffer.readUInt32BE(offset);
        if (fmt === 1) {
          // 28 octets d'en-tête avant le JPEG brut
          const jpegBuf = psdBuffer.slice(offset + 28, offset + dataLen);
          return jpegBuf;
        }
      }

      offset += dataLen;
      if (dataLen % 2 !== 0) offset += 1; // padding
    }
    return null;
  } catch (e) {
    console.warn('[psd-thumb] parse error', e.message);
    return null;
  }
}

async function getPsdThumbnail(filePath) {
  try {
    const psdBuffer = fs.readFileSync(filePath);
    const jpegBuf = extractPsdThumbnailBuffer(psdBuffer);

    if (jpegBuf && jpegBuf.length > 100) {
      return 'data:image/jpeg;base64,' + jpegBuf.toString('base64');
    }

    console.warn('[psd-thumb] pas de thumbnail embarqué dans', path.basename(filePath));
    return null;
  } catch (e) {
    console.warn('[psd-thumb] failed for', filePath, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Miniature embarquée dans les fichiers Office Open XML (docx, xlsx, pptx…)
// Ces fichiers sont des archives ZIP contenant docProps/thumbnail.jpeg
// ─────────────────────────────────────────────
async function getOfficeThumbnail(filePath) {
  if (process.platform !== 'win32') return null;
  if (/[\r\n|;`]/.test(filePath)) return null;

  const ext = path.extname(filePath).toLowerCase();
  const supported = ['.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.pptm',
                     '.odt', '.ods', '.odp', '.odg'];
  if (!supported.includes(ext)) return null;
  if (!fs.existsSync(filePath)) return null;

  const psPath = filePath.replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -Assembly System.IO.Compression.FileSystem
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead('${psPath}')
  $entry = $zip.Entries | Where-Object { $_.FullName -like 'docProps/thumbnail*' } | Select-Object -First 1
  if ($entry -eq $null) { $zip.Dispose(); exit 1 }
  $ms = New-Object System.IO.MemoryStream
  $s = $entry.Open()
  $s.CopyTo($ms)
  $s.Close()
  $zip.Dispose()
  [Convert]::ToBase64String($ms.ToArray())
} catch { exit 1 }
`;

  try {
    const { stdout } = await execFileAsync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8000 });

    const b64 = stdout.trim();
    if (!b64) return null;

    // Détecter le type MIME depuis les magic bytes
    const buf = Buffer.from(b64, 'base64');
    let mime = 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';  // PNG
    else if (buf[0] === 0x42 && buf[1] === 0x4D) mime = 'image/bmp'; // BMP

    // WMF/EMF : formats vectoriels sans utilité pour un rendu bitmap — ignorer
    if (buf[0] === 0xD7 && buf[1] === 0xCD) return null; // WMF
    if (buf[0] === 0x01 && buf[1] === 0x00) return null; // EMF

    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Miniature embarquée dans les fichiers InDesign (.indd)
// Le format INDD contient un bloc JPEG preview après son en-tête propriétaire
// ─────────────────────────────────────────────
function getInddThumbnail(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    // Limiter à 500 Mo pour éviter les lectures trop longues
    if (st.size > 500 * 1024 * 1024) return null;

    // Lire les 8 premiers Mo (le preview JPEG est généralement en tête de fichier)
    const fd = fs.openSync(filePath, 'r');
    const scanSize = Math.min(st.size, 8 * 1024 * 1024);
    const buf = Buffer.alloc(scanSize);
    fs.readSync(fd, buf, 0, scanSize, 0);
    fs.closeSync(fd);

    // Chercher la signature JPEG (FF D8 FF) dans le buffer
    const jpegSig = Buffer.from([0xFF, 0xD8, 0xFF]);
    let start = -1;
    for (let i = 0; i < buf.length - 3; i++) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xD8 && buf[i + 2] === 0xFF) {
        start = i;
        break;
      }
    }
    if (start === -1) return null;

    // Trouver la fin du JPEG (FF D9)
    let end = -1;
    for (let i = start + 2; i < buf.length - 1; i++) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xD9) {
        end = i + 2;
        break;
      }
    }
    if (end === -1) return null;

    const jpeg = buf.slice(start, end);
    // Taille minimum raisonnable (éviter les faux positifs trop petits)
    if (jpeg.length < 1024) return null;

    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

ipcMain.handle("get-file-preview", async (_evt, filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return await getPdfThumbnail(filePath) || getFileDocIcon(filePath) || null;
  }
  if (ext === '.psd' || ext === '.psb') {
    return await getPsdThumbnail(filePath) || getFileDocIcon(filePath) || null;
  }
  if (/^\.(docx|docm|xlsx|xlsm|pptx|pptm|odt|ods|odp|odg)$/.test(ext)) {
    return await getOfficeThumbnail(filePath)
      || getFileDocIcon(filePath)
      || await getCachedIconURL(filePath, 'large');
  }
  const docIcon = getFileDocIcon(filePath);
  if (docIcon) return docIcon;
  try {
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: 256, height: 256 });
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch { }
  return null;
});

// Fallback image → data URL (remplace la lecture directe fs dans le preload)
ipcMain.handle("read-image-as-dataurl", (_evt, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.avif': 'image/avif', '.ico': 'image/x-icon',
    };
    const mime = mimeMap[ext];
    if (!mime) return null;
    // Limiter à 20 Mo
    const st = fs.statSync(filePath);
    if (st.size > 20 * 1024 * 1024) return null;
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});

// ============================================================================
// ICONES (.lnk, .url, fichiers systèmes)
// ============================================================================
async function tryGetCustomIcon({ lnkPath, targetPath, appUserModelId }) {
  try {
    // 0) Icône assignée manuellement par l'utilisateur — priorité absolue
    for (const p of [lnkPath, targetPath].filter(Boolean)) {
      const dataURL = getUserIconDataURL(p);
      if (dataURL) return dataURL;
    }

    // 1) Par nom d'exécutable
    const exeName = (targetPath ? path.basename(targetPath) : path.basename(lnkPath)).toUpperCase();
    const preset = ICON_PRESETS[exeName];
    if (preset) {
      const full = await generateIconPngIfMissing(preset);
      if (full) {
        const img = nativeImage.createFromPath(full);
        if (img && !img.isEmpty()) return img.toDataURL();
      }
    }

    // 2) Par AppUserModelId si fourni
    if (appUserModelId) {
      const hit = ICON_PRESETS_AUMID.find(x => appUserModelId.toUpperCase().includes(x.contains));
      if (hit) {
        const preset = Object.values(ICON_PRESETS).find(i => i.file === hit.file);
        const full = await generateIconPngIfMissing(preset);
        if (full) {
          const img = nativeImage.createFromPath(full);
          if (img && !img.isEmpty()) return img.toDataURL();
        }
      }
    }
  } catch (e) {
    console.warn("[custom-icons] failed", e);
  }
  return null;
}
const iconCache = new Map();


// ─────────────────────────────────────────────
// Extraction robuste d’icône Windows par index (pour certains .lnk comme Thorium)
// ─────────────────────────────────────────────
async function extractIconPngViaPowerShell(filePath, iconIndex = 0) {
  // Uniquement utile sous Windows
  if (process.platform !== "win32") return null;

  try {
    // Validation : le filePath ne doit contenir que des caractères de chemin normaux
    // Rejeter les chemins suspects (retours à la ligne, pipe, etc.)
    if (/[\r\n|;]/.test(filePath)) {
      console.warn("[extractIcon] blocked suspicious path:", filePath);
      return null;
    }
    // Vérifier que le fichier existe et est un .exe, .dll ou .lnk
    const ext = path.extname(filePath).toLowerCase();
    if (!['.exe', '.dll', '.lnk', '.ico'].includes(ext)) return null;
    if (!fs.existsSync(filePath)) return null;

    // iconIndex peut être négatif (Resource ID Windows) — ne pas forcer à 0
    const safeIndex = Math.floor(Number(iconIndex) || 0);

    const outPng = path.join(os.tmpdir(), `fence_icon_${crypto.randomBytes(8).toString("hex")}.png`);

    // Échappement renforcé pour PowerShell : utiliser les single quotes (pas d'interpolation)
    // Seul le single quote doit être doublé dans une single-quoted string PS
    const psPath = filePath.replace(/'/g, "''");
    const psOut = outPng.replace(/'/g, "''");

    const ps = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
try {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${psPath}')
  if ($icon -eq $null) { throw "No icon from ExtractAssociatedIcon" }
  $bmp = $icon.ToBitmap()
  $bmp.Save('${psOut}', [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $icon.Dispose()
} catch {
  throw $_
}
`;

    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command", ps
    ], { windowsHide: true, timeout: 10000 });

    if (!fs.existsSync(outPng)) return null;

    const buf = fs.readFileSync(outPng);
    try { fs.unlinkSync(outPng); } catch { }
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    // Silencieux : on laissera les fallbacks fonctionner
    return null;
  }
}

/** Expanse les variables d'environnement Windows (%VAR%) dans un chemin */
function expandEnvVars(p) {
  if (!p || process.platform !== 'win32') return p;
  return p.replace(/%([^%]+)%/g, (_, varName) => process.env[varName] || `%${varName}%`);
}

// Marque un fichier comme caché (Hidden+System) — best-effort Windows.
// Objectif: si le placeholder est copié/déplacé sur le bureau pendant un drag,
// il restera invisible même si l'Explorer rafraîchit tardivement.
async function markFileHiddenSystemBestEffort(filePath) {
  if (process.platform !== 'win32') return;
  if (!filePath) return;
  try {
    // Priorité 1 : addon natif (immédiat)
    shellUtils?.hideFileNow?.(filePath);
  } catch {}
  try {
    // Priorité 2 : attrib via cmd (commande interne)
    // /c : exécute puis quitte
    await execFileAsync(
      'cmd.exe',
      ['/c', 'attrib', '+H', '+S', filePath],
      { windowsHide: true, timeout: 2000 }
    );
  } catch {}
}

async function getLnkIcon(lnkPath) {
  // 0) Icône assignée manuellement — priorité absolue, ignore le cache
  const userIcon = getUserIconDataURL(lnkPath);
  if (userIcon) return userIcon;

  if (iconCache.has(lnkPath)) return iconCache.get(lnkPath);
  try {
    const sc = shell.readShortcutLink(lnkPath);
    const tgt = (sc?.target || '').trim();
    if (tgt && iconCache.has(tgt)) return iconCache.get(tgt);
  } catch { }
  let result = null;
  let shortcut = null;

  // Lire le .lnk (sans PowerShell)
  try {
    shortcut = shell.readShortcutLink(lnkPath);
  } catch (e) {
  }

  // DEBUG
  if (shortcut) {
  } else {
  }

  // 1) Custom icon en priorité (safe, offline, zéro AV)
  if (shortcut) {
    const custom = await tryGetCustomIcon({
      lnkPath,
      targetPath: (shortcut.target || "").trim(),
      appUserModelId: (shortcut.appUserModelId || "").trim()
    });
    if (custom) {
      iconCache.set(lnkPath, custom);
      return custom;
    }

    // 1bis) Icône explicitement définie dans le raccourci (.lnk)
    // Très fréquent pour certains raccourcis : shortcut.icon (souvent .ico) + shortcut.iconIndex
    try {
      const iconPath = expandEnvVars((shortcut.icon || "").trim());
      const iconIndex = Number.isFinite(shortcut.iconIndex) ? shortcut.iconIndex : 0;

      // a) Si le .lnk pointe vers un fichier d’icône (.ico/.png/…)
      if (iconPath && fs.existsSync(iconPath)) {
        const ext = path.extname(iconPath).toLowerCase();
        if ([".ico", ".png", ".jpg", ".jpeg", ".bmp"].includes(ext)) {
          const img = nativeImage.createFromPath(iconPath);
          if (img && !img.isEmpty()) {
            result = img.toDataURL();
            iconCache.set(lnkPath, result);
            return result;
          }
        }

        // b) Si iconPath est un .exe/.dll et que l’index n’est pas 0, on extrait l’icône par index (Windows)
        if ([".exe", ".dll"].includes(ext)) {
          const byIndex = await extractIconPngViaPowerShell(iconPath, iconIndex);
          if (byIndex) {
            iconCache.set(lnkPath, byIndex);
            return byIndex;
          }
        }
      }

      // c) Cas courant : iconPath vide mais iconIndex défini -> utiliser la cible + index
      const target = (shortcut.target || "").trim();
      if (target && fs.existsSync(target) && (iconIndex || iconPath)) {
        const byIndex = await extractIconPngViaPowerShell(target, iconIndex);
        if (byIndex) {
          iconCache.set(lnkPath, byIndex);
          return byIndex;
        }
      }
    } catch (e) {
    }

    // 2) Icône réelle via la cible si accessible
    //    Si la cible est un DOSSIER, on saute à l'étape 3 (icône du .lnk)
    //    car getFileIcon(dossier) retourne une icône générique, alors que
    //    getFileIcon(.lnk) retourne l'icône correcte rendue par Windows.
    try {
      const target = (shortcut.target || "").trim();
      const targetAccessible = target && fs.existsSync(target);
      const targetStat = targetAccessible ? safeStat(target) : null;
      const isDir = targetStat ? targetStat.isDirectory()
        : target && !path.extname(target);

      if (isDir) {
        try {
          const size = 48;
          const canvas = createCanvas(size, size);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFA000';
          ctx.fillRect(2, 14, 18, 8);
          ctx.fillStyle = '#FFCA28';
          ctx.fillRect(2, 20, 44, 26);
          const png = canvas.toBuffer('image/png');
          result = 'data:image/png;base64,' + png.toString('base64');
          iconCache.set(lnkPath, result);
          return result;
        } catch (e) {
        }
      } else if (targetAccessible) {
        const icon = await app.getFileIcon(target, { size: "large" });
        if (icon && !icon.isEmpty()) {
          result = icon.toDataURL();
          iconCache.set(lnkPath, result);
          return result;
        }
      }
    } catch { }
  }
  // 3) Fallback : icône du .lnk lui-même
  try {
      const fallback = await app.getFileIcon(lnkPath, { size: "large" });
      if (fallback && !fallback.isEmpty()) {
        result = fallback.toDataURL();
        iconCache.set(lnkPath, result);
        return result;
      }
    } catch { }

    return null;
  }



  ipcMain.handle('get-file-icon', async (_evt, filePath) => {
    try {
      return await getCachedIconURL(filePath, 'normal');
    } catch (e) {
      console.warn('[get-file-icon] failed for', filePath, e);
      return null;
    }
  });




  ipcMain.handle('get-file-icon-large', async (_evt, filePath) => {
    try {
      // ── Priorité 1 : addon natif → icône jumbo Shell 256×256 ──
      if (shellUtils) {
        try {
          const iconData = shellUtils.getFileIconPng(filePath, 256);
          const dataURL = shellIconToDataURL(iconData);
          if (dataURL) return dataURL;
        } catch { }
      }

      // ── Priorité 2 : miniature Electron (images, vidéos, docs) ──
      if (!/\.lnk$/i.test(filePath) && !/\.html?$/i.test(filePath)) {
        try {
          const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 256, height: 256 });
          if (thumb && !thumb.isEmpty()) {
            const size = thumb.getSize();
            if (size.width >= 48 || size.height >= 48) return thumb.toDataURL();
          }
        } catch { }
      }

      // ── Priorité 3 : fallback app.getFileIcon ──
      return await getCachedIconURL(filePath, 'large');
    } catch (e) {
      console.warn('[get-file-icon-large] failed for', filePath, e);
      return null;
    }
  });



  // ─────────────────────────────────────────────
  // URL extraction (.url)
  // ─────────────────────────────────────────────

  ipcMain.handle("get-url-from-file", async (_evt, filePath) => {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const match = content.match(/URL=(.+)/i);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  });

  // ─────────────────────────────────────────────
  // OPEN, REVEAL
  // ─────────────────────────────────────────────

  ipcMain.handle("open-file", async (_evt, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') return;
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        console.warn("[open-file] blocked: path outside fences", p);
        return;
      }
      await shell.openPath(p);
    } catch (e) {
      console.error("[open-file]", e);
    }
  });

  ipcMain.handle("reveal-in-folder", (_evt, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') return;
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        console.warn("[reveal-in-folder] blocked: path outside fences", p);
        return;
      }
      shell.showItemInFolder(p);
    } catch (e) {
      console.error("[reveal]", e);
    }
  });

  // ─────────────────────────────────────────────
  // RENAME / DELETE / TRASH
  // ─────────────────────────────────────────────

  ipcMain.handle("rename-in-fence", async (_evt, { oldFullPath, newName }) => {
    try {
      if (!isPathInFences(oldFullPath)) throw new Error("Path outside fences directory");
      const safeName = sanitizeFileName(newName);
      const dest = ensureUniqueDest(path.join(path.dirname(oldFullPath), safeName));
      await fs.promises.rename(oldFullPath, dest);
      return dest;
    } catch (e) {
      console.error("[rename]", e);
      throw e;
    }
  });

  ipcMain.handle("delete-from-fence", async (_evt, filePath) => {
    try {
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        console.warn("[delete-from-fence] blocked: path outside fences", p);
        return false;
      }
      const st = fs.lstatSync(p);

      if (st.isDirectory()) {
        await fs.promises.rm(p, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(p);
      }

      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle("trash-item", async (_evt, filePath) => {
    try {
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        console.warn("[trash-item] blocked: path outside fences", p);
        return false;
      }
      await shell.trashItem(p);
      return true;
    } catch {
      return false;
    }
  });

  // ─────────────────────────────────────────────
  // DRAG & DROP INTER-FENCES
  // ─────────────────────────────────────────────

  ipcMain.handle("fence-drag-start", (_evt, { filePath, filePaths, fenceId }) => {
    // Accepte un seul fichier (filePath) ou plusieurs (filePaths)
    const paths = filePaths ?? (filePath ? [filePath] : []);
    draggedItem = { filePaths: paths, fenceId };
    // Sécurité : expiration automatique après 10s si aucun drop ne se produit
    if (draggedItem._expireTimer) clearTimeout(draggedItem._expireTimer);
    draggedItem._expireTimer = setTimeout(() => { draggedItem = null; }, 10000);
    return true;
  });

  // Drag natif : permet de déposer un fichier depuis une box vers le bureau ou l'explorateur
  ipcMain.handle("native-drag-start", async (evt, payload) => {
    try {
      const { filePaths, fenceId } = (payload && typeof payload === 'object') ? payload : { filePaths: payload, fenceId: null };
      // Accepte un chemin unique (string) ou un tableau
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      if (!paths.length) return false;

      // Ne conserver que des chemins valides issus des fences
      const validPaths = paths.filter(fp => {
        if (!fp || typeof fp !== 'string') return false;
        const p = path.normalize(fp);
        return fs.existsSync(p) && isPathInFences(p);
      });
      if (!validPaths.length) return false;

      const win = BrowserWindow.fromWebContents(evt.sender);
      if (!win || win.isDestroyed()) return false;

      const srcFenceId = (typeof fenceId === 'string' && isValidFenceId(fenceId)) ? fenceId : null;

      // NOTE:
      // Le DropTarget OLE ne s'enregistre pas chez certains utilisateurs, donc le drag inter-box
      // doit rester sur placeholder `startDrag`. On utilise donc placeholder pour TOUT drag
      // qui part d'une fence, et on finalise le drop sur le bureau via dragend (détection du placeholder).
      const winClass = (() => {
        try { return shellUtils?.getWindowClassUnderCursor?.(); } catch { return null; }
      })();

      // Fallback : ancienne méthode placeholder si l'addon n'a pas startFileDrag
      // ou si on est au-dessus d'une autre box (drag inter-box).
      if (winClass) { try { console.log('[native-drag-start] placeholder; winClass=', winClass); } catch {} }
      const firstNorm = path.normalize(validPaths[0]);
      let icon;
      try {
        icon = await app.getFileIcon(firstNorm, { size: 'small' });
        if (!icon || icon.isEmpty()) icon = null;
      } catch { icon = null; }
      if (!icon) {
        icon = nativeImage.createFromBuffer(Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNl7BcQAAAABJRU5ErkJggg==",
          "base64"
        ));
      }
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      // ⚠️ Certains environnements bloquent la création d'un nom fixe dans %TEMP% (EPERM).
      // Utiliser un nom unique à chaque drag évite les conflits/locks/policies.
      const tmpFile = path.join(
        os.tmpdir(),
        `boxes-drag-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tmp`
      );
      fs.writeFileSync(tmpFile, '');
      await markFileHiddenSystemBestEffort(tmpFile);
      lastDragPlaceholderBaseName = path.basename(tmpFile);
      lastDragPlaceholderPath = tmpFile;
      win.webContents.startDrag({ file: tmpFile, icon });

      _lastNativeDragStartAt = Date.now();
      _lastDesktopDetectAt = 0;
      try { console.log('[timing] native-drag-start placeholder=', lastDragPlaceholderBaseName); } catch {}

      // ── Finalisation bureau côté MAIN (évite throttling renderer) ──────────
      // Problème observé: si l'utilisateur ne bouge pas la souris après le drop,
      // le renderer peut être throttlé et ne pas lancer extractToDesktop tout de suite.
      // Ici on poll le bureau et on finalise dès que le placeholder apparaît.
      try {
        if (_desktopDropPollTimer) {
          clearInterval(_desktopDropPollTimer);
          _desktopDropPollTimer = null;
        }
        const desktop = app.getPath('desktop');
        const startedAt = Date.now();
        const name = lastDragPlaceholderBaseName;
        _desktopDropPollTimer = setInterval(async () => {
          try {
            if (!name) return;
            const p = path.join(desktop, name);
            if (!fs.existsSync(p)) {
              if (Date.now() - startedAt > 35000) {
                console.log('[desktop-drop] timeout waiting placeholder', name);
                clearInterval(_desktopDropPollTimer);
                _desktopDropPollTimer = null;
              }
              return;
            }

            const tDetect = Date.now();
            console.log('[desktop-drop] placeholder detected after', tDetect - startedAt, 'ms');
            clearInterval(_desktopDropPollTimer);
            _desktopDropPollTimer = null;

            // Nettoyer le placeholder rapidement
            try { shellUtils?.hideFileNow?.(p); } catch {}
            try { fs.unlinkSync(p); shellUtils?.notifyShellDelete?.(p); } catch {}

            // Finaliser le move réel vers le bureau si on a un drag en cours
            if (!draggedItem || !Array.isArray(draggedItem.filePaths) || draggedItem.filePaths.length === 0) return;
            const toMove = [...draggedItem.filePaths];
            const srcFence = draggedItem.fenceId;
            draggedItem = null;

            const tMove0 = Date.now();
            for (const fp of toMove) {
              try {
                const src = path.normalize(fp);
                if (!isPathInFences(src)) continue;
                const dest = ensureUniqueDest(path.join(desktop, path.basename(src)));
                await fs.promises.rename(src, dest);
                shellUtils?.notifyShellCreate?.(dest);
                shellUtils?.notifyShellDelete?.(src);
                // Extra refresh pour accélérer l'update visuel sur le Bureau
                shellUtils?.notifyShellUpdateItem?.(dest);
              } catch {}
            }
            shellUtils?.notifyShellRefreshDesktop?.(desktop);
            const tMove1 = Date.now();
            try {
              const dtFromDrag = _lastNativeDragStartAt ? (tMove1 - _lastNativeDragStartAt) : -1;
              console.log('[timing] main desktop finalize moved', toMove.length, 'file(s) in', (tMove1 - tMove0), 'ms', 'since drag start', dtFromDrag, 'ms');
            } catch {}

            if (srcFence && openFences.has(srcFence)) {
              openFences.get(srcFence).webContents.send("fence-refresh");
              try { console.log('[timing] fence-refresh sent to source fence after', Date.now() - tMove1, 'ms'); } catch {}
            }
          } catch {}
        }, 100);
      } catch {}

      return true;
    } catch (e) {
      console.warn("[native-drag-start] failed (non-fatal):", e.message);
      return false;
    }
  });

  // NOTE: le démarrage du drag OLE est fait côté preload (renderer process).
  // Le lancer depuis le main process a provoqué un crash natif (0xC0000005).

  ipcMain.on('cleanup-drag-placeholder', () => {
    const desktop = app.getPath('desktop');
    const candidates = [
      lastDragPlaceholderBaseName,
      'boxes-drag-placeholder.tmp', // compat ancien nom
    ].filter(Boolean);

    const doClean = () => {
      try {
        for (const name of candidates) {
          const desktopFile = path.join(desktop, name);
          if (fs.existsSync(desktopFile)) {
            fs.unlinkSync(desktopFile);
            // Notifier le Shell Windows pour effacer l'icône immédiatement
            shellUtils?.notifyShellDelete(desktopFile);
            return true;
          }
        }
      } catch {}
      return false;
    };
    // Polling toutes les 200ms pendant 15s max
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (doClean() || attempts >= 75) clearInterval(interval);
    }, 200);
  });

  ipcMain.handle("is-inter-fence-drag", () => {
    return draggedItem !== null;
  });

  // Vérifie si le placeholder de drag est sur le bureau (= dépôt effectif sur le bureau).
  // Retourne true immédiatement sans bloquer, supprime le placeholder en arrière-plan.
  ipcMain.handle("drag-dropped-on-desktop", () => {
    const desktop = app.getPath('desktop');
    const candidates = [
      lastDragPlaceholderBaseName,
      'boxes-drag-placeholder.tmp', // compat ancien nom
    ].filter(Boolean);

    for (const name of candidates) {
      const p = path.join(desktop, name);
      if (!fs.existsSync(p)) continue;
      if (!_lastDesktopDetectAt) {
        _lastDesktopDetectAt = Date.now();
        try {
          const dt = _lastNativeDragStartAt ? (_lastDesktopDetectAt - _lastNativeDragStartAt) : -1;
          console.log('[timing] drag-dropped-on-desktop detected after', dt, 'ms', 'name=', name);
        } catch {}
      }
      shellUtils?.hideFileNow?.(p);
      const tryDelete = (attempts) => {
        fs.promises.unlink(p)
          .then(() => shellUtils?.notifyShellDelete(p))
          .catch(() => { if (attempts > 0) setTimeout(() => tryDelete(attempts - 1), 500); });
      };
      tryDelete(20);
      return true;
    }
    return false;
  });

  ipcMain.handle("fence-drag-cancel", () => {
    // Appelé si le drag est abandonné (relâché dans le vide).
    // On ne fait rien ici — draggedItem sera écrasé par le prochain fenceDragStart
    // ou expiré par le timer posé dans fenceDragStart.
    // Ne surtout pas effacer immédiatement : drop sur la cible peut arriver juste après.
    return true;
  });

  ipcMain.handle("fence-drag-drop", async (_evt, { targetFenceId }) => {
    console.log('[fence-drag-drop] called — draggedItem:', draggedItem ? JSON.stringify({ paths: draggedItem.filePaths, src: draggedItem.fenceId }) : 'NULL', '— target:', targetFenceId);
    if (!draggedItem) return null;
    if (!isValidFenceId(targetFenceId)) {
      console.warn("[fence-drag-drop] blocked: invalid targetFenceId", targetFenceId);
      draggedItem = null;
      return null;
    }

    const { filePaths, fenceId: sourceFenceId } = draggedItem;

    if (sourceFenceId === targetFenceId) {
      console.log('[fence-drag-drop] same fence, skipping');
      draggedItem = null;
      return null;
    }

    // Annuler le timer d'expiration
    if (draggedItem._expireTimer) { clearTimeout(draggedItem._expireTimer); draggedItem._expireTimer = null; }

    const results = [];
    try {
      const targetDir = path.join(FENCES_BASE_DIR, targetFenceId);
      fs.mkdirSync(targetDir, { recursive: true });

      for (const filePath of filePaths) {
        try {
          const p = path.normalize(filePath);
          if (!isPathInFences(p)) {
            console.warn("[fence-drag-drop] blocked path:", p);
            continue;
          }
          const fileName = path.basename(p);
          const dest = ensureUniqueDest(path.join(targetDir, fileName));
          await fs.promises.rename(p, dest);
          results.push(dest);
          console.log('[fence-drag-drop] moved:', p, '->', dest);
        } catch (err) {
          console.error("[fence-drag-drop] move failed for", filePath, err);
        }
      }

      if (openFences.has(sourceFenceId)) {
        openFences.get(sourceFenceId).webContents.send("fence-refresh");
      }

      // Nettoyer le placeholder inter-box (créé par startDrag)
      try {
        if (lastDragPlaceholderPath && fs.existsSync(lastDragPlaceholderPath)) {
          fs.unlinkSync(lastDragPlaceholderPath);
        }
      } catch {}
      lastDragPlaceholderPath = null;

      draggedItem = null;
      console.log('[fence-drag-drop] success —', results.length, 'file(s) moved');
      return results.length > 0 ? results : null;
    } catch (e) {
      console.error('[fence-drag-drop] fatal:', e);
      draggedItem = null;
      return null;
    }
  });

  // ─────────────────────────────────────────────
  // FILE STAT + EXTRACT TO DESKTOP
  // ─────────────────────────────────────────────

  ipcMain.handle("get-file-stat", (_evt, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') return null;
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        console.warn("[get-file-stat] blocked: path outside fences", p);
        return null;
      }
      const st = fs.statSync(p);
      return { mtime: st.mtimeMs, size: st.size, isDirectory: st.isDirectory() };
    } catch {
      return null;
    }
  });

  ipcMain.handle("extract-to-desktop", async (_evt, { filePath, move }) => {
    try {
      const t0 = Date.now();
      const p = path.normalize(filePath);
      if (!isPathInFences(p)) {
        return { ok: false, error: "Chemin non autorisé" };
      }
      const desktop = app.getPath("desktop");
      const dest = ensureUniqueDest(path.join(desktop, path.basename(p)));

      const st = fs.lstatSync(p);

      if (move) {
        await fs.promises.rename(p, dest);
        shellUtils?.notifyShellCreate(dest);
        shellUtils?.notifyShellDelete(p);
      } else {
        if (st.isDirectory()) {
          await fs.promises.cp(p, dest, { recursive: true });
        } else {
          await fs.promises.copyFile(p, dest);
        }
      }

      try {
        const t1 = Date.now();
        const since = _lastNativeDragStartAt ? (t1 - _lastNativeDragStartAt) : -1;
        console.log('[timing] extract-to-desktop', move ? 'MOVE' : 'COPY', 'took', (t1 - t0), 'ms', 'since drag start', since, 'ms');
      } catch {}
      return { ok: true, destPath: dest };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ─────────────────────────────────────────────
  // AUTO-ORGANISE BUREAU — déplace l'original dans un dossier du nom de la box
  // ─────────────────────────────────────────────

  ipcMain.handle("get-auto-organize-desktop", () => {
    const cfg = readConfig();
    return cfg.autoOrganizeDesktop ?? true; // activé par défaut
  });

  ipcMain.handle("set-auto-organize-desktop", (_evt, enable) => {
    const cfg = readConfig();
    cfg.autoOrganizeDesktop = !!enable;
    writeConfig(cfg);
    return !!enable;
  });

  /**
   * Après un copy-to-fence depuis le bureau, déplace l'original du bureau
   * dans un sous-dossier portant le nom de la box.
   * - Ne s'applique que si le fichier source est sur le bureau
   * - Crée le dossier "NomDeLaBox" sur le bureau si nécessaire
   * - Gère les doublons de nom
   */
  ipcMain.handle("move-original-to-box-folder", async (_evt, { srcFullPath, fenceId }) => {
    try {
      const cfg = readConfig();

      // Vérifier que l'option est activée
      if (!(cfg.autoOrganizeDesktop ?? true)) {
        return { ok: false, reason: "disabled" };
      }

      // Vérifier que le fichier source est bien sur le bureau (pas dans un sous-dossier)
      const desktop = app.getPath("desktop");
      const srcNorm = path.normalize(srcFullPath);
      const desktopNorm = path.normalize(desktop);
      const srcDir = path.dirname(srcNorm);

      if (srcDir.toLowerCase() !== desktopNorm.toLowerCase()) {
        return { ok: false, reason: "not-on-desktop" };
      }

      // Vérifier que le fichier existe encore
      if (!fs.existsSync(srcNorm)) {
        return { ok: false, reason: "source-missing" };
      }

      // Récupérer le nom de la fence
      const fence = cfg.fences.find(f => f.id === fenceId);
      if (!fence) {
        return { ok: false, reason: "fence-not-found" };
      }

      const fenceName = fence.name || "Fence";
      // Nettoyer le nom pour éviter les caractères interdits dans un nom de dossier
      const safeName = fenceName.replace(/[<>:"/\\|?*]/g, "_").trim() || "Fence";
      const boxFolder = path.join(desktop, safeName);

      // Créer le dossier si nécessaire
      fs.mkdirSync(boxFolder, { recursive: true });

      // Déplacer le fichier original dans ce dossier
      const fileName = path.basename(srcNorm);
      const dest = path.join(boxFolder, fileName);

      // Si le fichier existe déjà dans le dossier de la box, l'écraser (au lieu de créer " (1)")
      try {
        if (fs.existsSync(dest)) {
          await fs.promises.rm(dest, { recursive: true, force: true });
        }
      } catch {}

      await fs.promises.rename(srcNorm, dest);

      return { ok: true, destPath: dest, folderPath: boxFolder };
    } catch (e) {
      console.error("[move-original-to-box-folder]", e);
      return { ok: false, error: e.message };
    }
  });

  // ─────────────────────────────────────────────
  // REDIMENSIONNEMENT FENCE (poignées renderer)
  // ─────────────────────────────────────────────

  ipcMain.handle("resize-by", (evt, type, dx, dy) => {
    try {
      const win = BrowserWindow.fromWebContents(evt.sender);
      if (!win) { console.warn('[resize] no win'); return; }

      // Utiliser getBounds() comme source unique de vérité (position + taille)
      const b = win.getBounds();
      const MIN_W = FENCE_MIN_W;

      // Respecter le minHeight selon l'état roulé de la fence
      const fenceId = [...openFences.entries()].find(([, w]) => w === win)?.[0];
      const cfg = fenceId ? readConfig() : null;
      const fenceCfg = cfg?.fences.find(f => f.id === fenceId);
      const MIN_H = fenceCfg?.rolled ? TITLE_HEIGHT : 80;

      // Limiter à la taille de l'écran courant
      const display = screen.getDisplayMatching(b);
      const MAX_W = display.workAreaSize.width;
      const MAX_H = display.workAreaSize.height;

      const newW = Math.min(MAX_W, Math.max(MIN_W, b.width + Math.round(dx)));
      const newH = Math.min(MAX_H, Math.max(MIN_H, b.height + Math.round(dy)));

      // Trick Windows DWM : toggle resizable pour forcer l'acceptation du setBounds
      win.setResizable(false);
      if (type === 'south') {
        // Sur Windows transparent+frameless, forcer width+1 puis width pour débloquer DWM
        win.setBounds({ x: b.x, y: b.y, width: b.width + 1, height: newH }, false);
        win.setBounds({ x: b.x, y: b.y, width: b.width, height: newH }, false);
      } else if (type === 'southeast') {
        win.setBounds({ x: b.x, y: b.y, width: newW, height: newH }, false);
      }
      win.setResizable(true);
    } catch (e) {
      console.error('[resize] error', e);
    }
  });

  ipcMain.handle("resize-end", (evt) => {
    // rien à nettoyer avec cette approche
  });

  // ─────────────────────────────────────────────
  // ICÔNES PERSONNALISÉES
  // ─────────────────────────────────────────────

  ipcMain.handle('set-custom-icon', async (_evt, { filePath, imageBuffer }) => {
    try {
      const stem = sanitizeFileName(
        path.basename(filePath, path.extname(filePath))
      ).toLowerCase();
      if (!stem) return { ok: false, error: 'Nom de fichier invalide' };
      const dest = path.join(USER_ICON_DIR, stem + '.png');

      // Limiter la taille du buffer (10 Mo max)
      if (!imageBuffer || imageBuffer.byteLength > 10 * 1024 * 1024) {
        return { ok: false, error: 'Fichier trop volumineux (max 10 Mo)' };
      }
      const buf = Buffer.from(imageBuffer);

      // Essai direct via nativeImage
      let img = nativeImage.createFromBuffer(buf);

      // Fallback : si le buffer échoue (ex: .ico multi-résolution), écrire le fichier
      // temporairement sur disque et le lire via createFromPath
      if (img.isEmpty()) {
        const tmp = path.join(USER_ICON_DIR, '_tmp_icon_' + Date.now());
        fs.writeFileSync(tmp, buf);
        try {
          img = nativeImage.createFromPath(tmp);
          // Pour les .ico, app.getFileIcon donne de meilleurs résultats
          if (img.isEmpty()) {
            const icon = await app.getFileIcon(tmp, { size: 'large' });
            if (icon && !icon.isEmpty()) img = icon;
          }
        } finally {
          try { fs.unlinkSync(tmp); } catch { }
        }
      }

      if (img.isEmpty()) return { ok: false, error: 'Image invalide ou format non supporté' };

      // Normaliser à 256×256 max
      const { width, height } = img.getSize();
      if (width > 256 || height > 256) img = img.resize({ width: 256, height: 256 });

      fs.writeFileSync(dest, img.toPNG());
      iconCache.delete(filePath);
      return { ok: true };
    } catch (e) {
      console.error('[set-custom-icon]', e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('remove-custom-icon', (_evt, filePath) => {
    try {
      const p = getUserIconPath(filePath);
      if (p) fs.unlinkSync(p);
      iconCache.delete(filePath);
      return true;
    } catch { return false; }
  });

  ipcMain.handle('pick-icon-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      title: 'Choisir une icône',
      defaultPath: USER_ICON_DIR,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('read-file-as-buffer', async (_evt, filePath) => {
    try {
      // Limiter aux extensions d'images (utilisé uniquement pour les icônes personnalisées)
      const ext = path.extname(filePath).toLowerCase();
      const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.ico', '.bmp'];
      if (!allowed.includes(ext)) {
        console.warn('[read-file-as-buffer] blocked: extension not allowed', ext);
        return null;
      }
      // Limiter la taille (10 Mo max)
      const st = fs.statSync(filePath);
      if (st.size > 10 * 1024 * 1024) {
        console.warn('[read-file-as-buffer] blocked: file too large', st.size);
        return null;
      }
      const buf = fs.readFileSync(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
      console.error('[read-file-as-buffer]', e);
      return null;
    }
  });

  // ─────────────────────────────────────────────
  // ORDRE MANUEL DES ITEMS
  // ─────────────────────────────────────────────

  ipcMain.handle('get-fence-order', (_evt, fenceId) => {
    if (!isValidFenceId(fenceId)) return [];
    const cfg = readConfig();
    const f = cfg.fences.find(x => x.id === fenceId);
    return f?.itemOrder ?? [];
  });

  ipcMain.handle('set-fence-order', (_evt, { fenceId, order }) => {
    if (!isValidFenceId(fenceId)) return false;
    if (!Array.isArray(order)) return false;
    const cfg = readConfig();
    const f = cfg.fences.find(x => x.id === fenceId);
    if (f) {
      // Garder uniquement les noms de fichiers (basename), pas les chemins complets
      f.itemOrder = order.map(p => (typeof p === 'string' ? p.split(/[\\/]/).pop() : '')).filter(Boolean);
      writeConfig(cfg);
    }
    return true;
  });

  // ─────────────────────────────────────────────
  // DUPLIQUER UNE FENCE
  // ─────────────────────────────────────────────

  ipcMain.handle('duplicate-fence', async (_evt, fenceId) => {
    try {
      if (!isValidFenceId(fenceId)) throw new Error('Invalid fenceId');
      const cfg = readConfig();
      const src = cfg.fences.find(f => f.id === fenceId);
      if (!src) throw new Error('Fence introuvable');

      const newId = uuidv4();
      const newName = src.name + ' (copie)';

      // Copier le dossier de fichiers
      const srcDir = path.join(FENCES_BASE_DIR, fenceId);
      const dstDir = path.join(FENCES_BASE_DIR, newId);
      if (fs.existsSync(srcDir)) {
        await fs.promises.cp(srcDir, dstDir, { recursive: true });
      } else {
        fs.mkdirSync(dstDir, { recursive: true });
      }

      // Créer l'entrée config avec un léger décalage de position
      const newFence = {
        ...src,
        id: newId,
        name: newName,
        bounds: {
          ...src.bounds,
          x: (src.bounds?.x ?? 100) + 30,
          y: (src.bounds?.y ?? 100) + 30,
        }
      };
      cfg.fences.push(newFence);
      writeConfig(cfg);

      // Ouvrir la nouvelle fence
      createFence(newId, newName);

      return { id: newId, name: newName };
    } catch (e) {
      console.error('[duplicate-fence]', e);
      return null;
    }
  });





  // ─────────────────────────────────────────────
  // ROLLUP — réduire une box à sa barre de titre
  // ─────────────────────────────────────────────

  ipcMain.handle('fence-toggle-rollup', (_evt, fenceId) => {
    if (!isValidFenceId(fenceId)) return false;
    const win = openFences.get(fenceId);
    if (!win || win.isDestroyed()) return false;

    const cfg = readConfig();
    const f = cfg.fences.find(x => x.id === fenceId);
    if (!f) return false;

    const isRolled = f.rolled ?? false;
    const b = win.getBounds();

    if (isRolled) {
      // Dérouler : restaurer la hauteur et le minHeight d'origine
      const savedHeight = f.unrolledHeight ?? 360;
      f.rolled = false;
      delete f.unrolledHeight;
      writeConfig(cfg);
      win.setMinimumSize(FENCE_MIN_W, 300);
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: savedHeight });
      win.webContents.send('rolled-state-changed', false);
      return false; // nouveau état : pas roulé
    } else {
      // Rouler : abaisser minHeight, sauvegarder la hauteur, réduire
      f.rolled = true;
      f.unrolledHeight = b.height;
      writeConfig(cfg);
      win.setMinimumSize(FENCE_MIN_W, TITLE_HEIGHT);
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: TITLE_HEIGHT });
      win.webContents.send('rolled-state-changed', true);
      return true; // nouveau état : roulé
    }
  });

  ipcMain.handle('fence-set-locked', (_evt, fenceId, locked) => {
    if (!isValidFenceId(fenceId)) return;
    const win = openFences.get(fenceId);
    if (!win || win.isDestroyed()) return;

    const cfg = readConfig();
    const f = cfg.fences.find(x => x.id === fenceId);
    if (!f) return;

    f.locked = locked;
    writeConfig(cfg);

    if (locked) {
      win._setLockedBounds(win.getBounds());
    } else {
      win._setLockedBounds(null);
    }

    win.webContents.send('locked-state-changed', locked);
  });

  ipcMain.handle("get-autostart", () => {
    const cfg = readConfig();
    return cfg.autostart ?? false;
  });

  ipcMain.handle("set-autostart", (_evt, enable) => {
    try {
      const cfg = readConfig();
      cfg.autostart = !!enable;
      writeConfig(cfg);

      app.setLoginItemSettings({
        openAtLogin: !!enable,
        openAsHidden: true,
        args: ['--hidden'],
      });

      return true;
    } catch (e) {
      return false;
    }
  });



  // ─────────────────────────────────────────────
  // EXPORT / IMPORT DU PROFIL BOXES
  // ─────────────────────────────────────────────
  function formatStamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate())
    ].join('') + '-' + [
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
  }

  function copyDirContentsSync(srcDir, dstDir, { exclude = new Set() } = {}) {
    fs.mkdirSync(dstDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      const src = path.join(srcDir, entry.name);
      const dst = path.join(dstDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        copyDirContentsSync(src, dst, { exclude });
      } else if (entry.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }
  function copyDirContentsSyncCount(srcDir, dstDir, { exclude = new Set(), allowedExtensions = null } = {}) {
    let count = 0;
    fs.mkdirSync(dstDir, { recursive: true });

    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;

      const src = path.join(srcDir, entry.name);
      const dst = path.join(dstDir, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        count += copyDirContentsSyncCount(src, dst, { exclude, allowedExtensions });
      } else if (entry.isFile()) {
        // Filtrer par extension si une liste est fournie
        if (allowedExtensions && !allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        fs.copyFileSync(src, dst);
        count++;
      }
    }

    return count;
  }
  function closeAllFenceWindowsExcept(optionalKeepWin = null) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (optionalKeepWin && win === optionalKeepWin) continue;
      try { win.close(); } catch { }
    }
  }

  ipcMain.handle('export-profile', async () => {
    try {
      const exportRoot = path.join(
        app.getPath('desktop'),
        `Boxes-icons-${formatStamp()}`
      );
      const exportIconsDir = path.join(exportRoot, 'custom-icons');

      fs.mkdirSync(exportIconsDir, { recursive: true });

      const cfg = readConfig();
      const usedIconPaths = new Set();

      for (const fence of (cfg.fences || [])) {
        const fenceDir = path.join(FENCES_BASE_DIR, fence.id);
        if (!fs.existsSync(fenceDir)) continue;

        for (const entry of fs.readdirSync(fenceDir, { withFileTypes: true })) {
          const entryName = entry.name;
          const stem = path.basename(entryName, path.extname(entryName)).toLowerCase();

          for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.ico']) {
            const iconPath = path.join(USER_ICON_DIR, stem + ext);
            if (fs.existsSync(iconPath)) {
              usedIconPaths.add(iconPath);
              break;
            }
          }
        }
      }

      let count = 0;
      for (const src of usedIconPaths) {
        const dst = path.join(exportIconsDir, path.basename(src));
        fs.copyFileSync(src, dst);
        count++;
      }

      return {
        ok: true,
        exportPath: exportRoot,
        count
      };
    } catch (e) {
      console.error('[export-profile]', e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('import-profile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Choisir un dossier d’icônes Boxes',
        defaultPath: app.getPath('desktop'),
        properties: ['openDirectory']
      });

      if (result.canceled || !result.filePaths?.length) {
        return { ok: false, canceled: true };
      }

      const selectedDir = result.filePaths[0];

      let srcIconsDir = null;

      // Cas 1 : on a choisi directement le dossier custom-icons
      if (path.basename(selectedDir).toLowerCase() === 'custom-icons') {
        srcIconsDir = selectedDir;
      }
      // Cas 2 : on a choisi le dossier parent qui contient custom-icons
      else {
        const candidate = path.join(selectedDir, 'custom-icons');
        if (fs.existsSync(candidate)) {
          srcIconsDir = candidate;
        }
      }

      if (!srcIconsDir || !fs.existsSync(srcIconsDir)) {
        return {
          ok: false,
          error: 'Le dossier sélectionné ne contient pas d’icônes importables.'
        };
      }

      fs.mkdirSync(USER_ICON_DIR, { recursive: true });
      const count = copyDirContentsSyncCount(srcIconsDir, USER_ICON_DIR, {
        allowedExtensions: new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico'])
      });

      return {
        ok: true,
        importedFrom: selectedDir,
        count,
        restartRequired: false
      };
    } catch (e) {
      console.error('[import-profile]', e);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('restart-app', () => {
    try {
      app.relaunch();
      app.exit(0);
      return true;
    } catch {
      return false;
    }
  });


  // ============================================================================
  // CYCLE DE VIE ELECTRON
  // ============================================================================

  app.disableHardwareAcceleration();
  app.on("open-file", (e) => e.preventDefault());
  // ── Création du raccourci bureau au premier lancement ──
  function createDesktopShortcutIfNeeded() {
    try {
      const desktop = app.getPath('desktop');
      const exePath = process.execPath;
      const version = app.getVersion();
      const shortcutName = "Boxes " + version + ".lnk";
      const shortcutPath = path.join(desktop, shortcutName);
      for (const entry of fs.readdirSync(desktop)) {
        if (/^Boxes.*[.]lnk$/i.test(entry) && entry !== shortcutName) {
          try { fs.unlinkSync(path.join(desktop, entry)); } catch { }
        }
      }
      shell.writeShortcutLink(shortcutPath, {
        target: exePath,
        icon: APP_ICON,
        iconIndex: 0,
        description: "Boxes v" + version + " - Gestionnaire de fences"
      });
    } catch (e) {
      console.warn('[shortcut]', e.message);
    }
  }
  // ─────────────────────────────────────────────
  // TRAY
  // ─────────────────────────────────────────────
  let tray = null;

  function getManagerWin() {
    return BrowserWindow.getAllWindows().find(w => {
      try { return w.getTitle().includes('Manager') || w.getTitle().includes('Boxes'); } catch { return false; }
    }) || null;
  }

  function buildTrayMenu() {
    const cfg = readConfig();
    const fenceItems = (cfg.fences || []).map(f => ({
      label: f.name || 'Box sans nom',
      click: () => {
        if (openFences.has(f.id)) {
          const win = openFences.get(f.id);
          win.show();
          win.focus();
        } else {
          createFence(f.id, f.name);
        }
      }
    }));

    return Menu.buildFromTemplate([
      {
        label: 'My Boxes',
        enabled: false,
      },
      { type: 'separator' },
      ...(fenceItems.length
        ? fenceItems
        : [{ label: 'Aucune box', enabled: false }]
      ),
      { type: 'separator' },
      {
        label: 'Ouvrir le gestionnaire',
        click: () => {
          const mgr = getManagerWin();
          if (mgr) { mgr.show(); mgr.focus(); }
        }
      },
      {
        label: 'Tout afficher',
        click: () => {
          const mgr = getManagerWin();
          if (mgr) { mgr.show(); mgr.focus(); }
          for (const win of openFences.values()) { try { win.show(); } catch { } }
        }
      },
      {
        label: 'Tout masquer',
        click: () => {
          const mgr = getManagerWin();
          if (mgr) mgr.hide();
          for (const win of openFences.values()) { try { win.hide(); } catch { } }
        }
      },
      { type: 'separator' },
      {
        label: 'Quitter Boxes',
        click: () => app.quit()
      }
    ]);
  }

  function createTray() {
    if (tray) return;
    try {
      // Utiliser l'icône .ico existante
      const iconPath = (() => {
        const p1 = path.join(process.resourcesPath, 'assets', 'icon.ico');
        if (fs.existsSync(p1)) return p1;
        return path.join(__dirname, 'assets', 'icon.ico');
      })();

      const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      tray = new Tray(trayIcon);
      tray.setToolTip('Boxes — Gestionnaire de boxes');

      // Clic gauche → afficher/masquer le manager
      tray.on('click', () => {
        const mgr = getManagerWin();
        if (!mgr) return;
        if (mgr.isVisible() && !mgr.isMinimized()) {
          mgr.hide();
        } else {
          mgr.show();
          mgr.focus();
        }
      });

      // Clic droit → menu contextuel
      tray.on('right-click', () => {
        tray.setContextMenu(buildTrayMenu());
        tray.popUpContextMenu();
      });

    } catch (e) {
      console.warn('[tray] création échouée', e.message);
    }
  }

  app.whenReady().then(() => {
    // Si on lance en "stop", quitter immédiatement sans créer de fenêtres.
    if (process.argv.includes('--quit-now')) {
      app.isQuitting = true;
      app.quit();
      return;
    }

    // Nettoyer tout placeholder résiduel sur le bureau (peut bloquer les drops natifs)
    try {
      const desktop = app.getPath('desktop');
      for (const entry of (fs.readdirSync(desktop) || [])) {
        if (entry === 'boxes-drag-placeholder.tmp' || /^boxes-drag-.*\.tmp$/i.test(entry)) {
          const residual = path.join(desktop, entry);
          try { fs.renameSync(residual, path.join(os.tmpdir(), `boxes-drag-cleanup-${Date.now()}-${entry}`)); }
          catch { try { fs.unlinkSync(residual); } catch {} }
          shellUtils?.notifyShellDelete(residual);
        }
      }
    } catch {}

    createDesktopShortcutIfNeeded();
    ensureBaseDir();

    // Lancé au démarrage automatique avec --hidden ?
    const startHidden = process.argv.includes('--hidden');

    const cfg = readConfig();
    const managerWin = createManager();

    // Empêcher la fermeture complète depuis le bouton X du manager — masquer à la place
    managerWin.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        managerWin.hide();
      }
    });

    // Premier lancement (aucune box créée) → afficher le Manager obligatoirement.
    // Sinon (des boxes existent déjà) → se réduire dans le tray automatiquement.
    const hasFences = (cfg.fences || []).length > 0;
    if (startHidden || hasFences) {
      managerWin.hide();
    }

    createTray();

    // ── Raccourci global Alt+Espace : afficher/masquer toutes les boxes ──
    try {
      globalShortcut.register('Alt+Space', () => {
        const wins = [...openFences.values()];
        const anyVisible = wins.some(w => { try { return w.isVisible(); } catch { return false; } });
        for (const win of wins) {
          try { anyVisible ? win.hide() : win.show(); } catch {}
        }
      });
    } catch (e) {
      console.warn('[globalShortcut] enregistrement échoué:', e.message);
    }

    for (const f of cfg.fences || []) createFence(f.id, f.name);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createManager();
    });

    // ── Mise à jour automatique ──
    autoUpdater.checkForUpdatesAndNotify();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    try { globalShortcut.unregisterAll(); } catch {}
  });

  app.on("window-all-closed", () => {
    // Avec le tray, on ne quitte pas quand toutes les fenêtres sont fermées
    // L'app continue de vivre dans le systray
    // Quitter uniquement sur macOS si pas de tray (comportement standard)
    if (process.platform !== "darwin" && !tray) app.quit();
  });