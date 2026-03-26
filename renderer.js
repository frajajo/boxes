// renderer.js — version multi-fences

const container = document.getElementById('container');
const titleEl = document.querySelector('#titlebar .title');

let currentFenceId = null;
let currentStyle = { color: '#1e1e1e', opacity: 0.6 };
let currentIconSize = 48; // px — 32 | 48 | 128 | 256
let currentShowExtensions = false;

// ── CSS dynamique pour l'état roulé (box réduite à sa barre de titre) ──
(() => {
  const s = document.createElement('style');
  s.textContent = `body.rolled #container { display: none !important; }`;
  document.head.appendChild(s);
})();

function applyRolledState(isRolled) {
  document.body.classList.toggle('rolled', !!isRolled);
}

// Extensions toujours masquées (fichiers système)
const ALWAYS_HIDDEN_EXTS = /\.(lnk|url|exe|bat|cmd|ps1|vbs|js|msi|appref-ms)$/i;

function getDisplayName(fullPath) {
  const base = fullPath.split(/[\\/]/).pop();
  if (ALWAYS_HIDDEN_EXTS.test(base)) return base.replace(/\.[^.]+$/, '');
  if (!currentShowExtensions) return base.replace(/\.[^.]+$/, '');
  return base;
}

// ── Ordre de tri courant
let sortMode = 'none'; // 'none' | 'name' | 'type' | 'date'
let sortAsc = true;
let manualOrder = []; // ordre manuel persisté (basenames)

// ───────────────────────────────────────────────
// Initialisation : récupérer l'ID de la fence
// ───────────────────────────────────────────────

(async () => {
  try {
    currentFenceId = await window.api.getCurrentFenceId();
    if (!currentFenceId) {
      titleEl.textContent = 'Erreur';
      return;
    }

    const fenceInfo = await window.api.getFenceInfo(currentFenceId);
    if (fenceInfo) {
      titleEl.textContent = fenceInfo.name;
      document.title = fenceInfo.name;
    } else {
      titleEl.textContent = 'Fence';
    }

    // Appliquer le style sauvegardé
    if (fenceInfo?.style) {
      currentStyle = fenceInfo.style;
      applyStyle(currentStyle);
    }

    // Appliquer la taille d'icône sauvegardée
    if (fenceInfo?.iconSize) {
      currentIconSize = fenceInfo.iconSize;
    }
    applyIconSize(currentIconSize);

    // Appliquer le réglage d'affichage des extensions
    if (typeof fenceInfo?.showExtensions === 'boolean') {
      currentShowExtensions = fenceInfo.showExtensions;
    }

    // Appliquer l'état roulé sauvegardé
    if (fenceInfo?.rolled) applyRolledState(true);

    // Mettre à jour l'état roulé en temps réel (depuis main.js)
    window.api.onRolledStateChanged((isRolled) => applyRolledState(isRolled));

    buildSortMenu();
    buildStyleMenu();

    // Charger l'ordre manuel sauvegardé
    manualOrder = await window.api.getFenceOrder(currentFenceId) ?? [];

    await loadFenceItems();

    // Rafraîchir si une autre fence a déplacé un fichier ici
    window.api.onFenceRefresh(() => loadFenceItems());

    // Mettre à jour la taille des icônes en temps réel
    window.api.onIconSizeChanged(async (size) => {
      const info = await window.api.getFenceInfo(currentFenceId);
      const newSize = size ?? info?.iconSize ?? currentIconSize;
      currentIconSize = newSize;
      applyIconSize(newSize);
      await loadFenceItems();
    });

    // Mettre à jour l'affichage des extensions en temps réel
    window.api.onShowExtensionsChanged(async (val) => {
      currentShowExtensions = val;
      await loadFenceItems();
    });
  } catch (e) {
    titleEl.textContent = 'Erreur';
  }
})();

// ───────────────────────────────────────────────
// Titre éditable
// ───────────────────────────────────────────────

titleEl.setAttribute('title', 'Cliquez pour renommer');
titleEl.addEventListener('click', async () => {
  if (titleEl.dataset.editing === '1') return;
  if (!currentFenceId) return;

  titleEl.dataset.editing = '1';

  const current = titleEl.textContent || 'Fence';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'title-edit';
  input.spellcheck = false;

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  const finish = async (commit) => {
    try {
      if (commit) {
        const val = (input.value || '').trim();
        const saved = await window.api.setFenceName(currentFenceId, val);
        titleEl.textContent = saved;
        document.title = saved;
      } else {
        titleEl.textContent = current;
      }
    } finally {
      titleEl.dataset.editing = '0';
    }
  };

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); await finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); await finish(false); }
  });
  input.addEventListener('blur', async () => { await finish(true); });
});

// ── Double-clic sur la zone centrale de la barre de titre → rouler / dérouler ──
document.querySelector('#titlebar .titlebar-rollup-zone')?.addEventListener('dblclick', async () => {
  if (titleEl.dataset.editing === '1') return;
  if (!currentFenceId) return;
  // L'état visuel est appliqué via onRolledStateChanged (événement IPC depuis main.js)
  await window.api.toggleRollup(currentFenceId);
});

// ───────────────────────────────────────────────
// Drag & Drop
// ───────────────────────────────────────────────

// Empêcher le comportement par défaut du navigateur sur dragover uniquement
// NE PAS intercepter 'drop' sur window — cela vide dataTransfer.files avant
// que le listener sur #container ne puisse les lire
window.addEventListener('dragover', e => e.preventDefault(), false);

// ── Drag visuel sur le container ──
container.addEventListener('dragenter', e => {
  e.preventDefault();
  e.stopPropagation();
});

container.addEventListener('dragover', e => {
  e.preventDefault();
  e.stopPropagation();
  // window.__interFenceDrag est positionné dès le dragstart dans la même session
  // C'est fiable pour l'indicateur visuel (pas besoin d'IPC async ici)
  if (window.__interFenceDrag) {
    container.classList.add('drop-inter');
    container.classList.remove('drop-hint');
    e.dataTransfer.dropEffect = 'move';
  } else {
    container.classList.add('drop-hint');
    container.classList.remove('drop-inter');
    e.dataTransfer.dropEffect = 'copy';
  }
});

container.addEventListener('dragleave', e => {
  // Ne retirer la classe que si on quitte vraiment le container
  // (dragleave se déclenche aussi quand on survole un enfant)
  if (!container.contains(e.relatedTarget)) {
    container.classList.remove('drop-hint');
    container.classList.remove('drop-inter');
  }
});

container.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  container.classList.remove('drop-hint');
  container.classList.remove('drop-inter');
  if (!currentFenceId) return;


  // Lire files AVANT tout await — dataTransfer est vidé dès qu'on perd la main
  const files = Array.from(e.dataTransfer?.files ?? []);

  // isInterFenceDrag est la source de vérité — il prime sur files.length
  const isInterFence = await window.api.isInterFenceDrag();

  if (isInterFence) {
    // ── Cas drag inter-fences (toujours prioritaire)
    container.querySelectorAll('.icon.dragging').forEach(el => { el._dropHandled = true; });
    const destPaths = await window.api.fenceDragDrop(currentFenceId);
    if (destPaths && destPaths.length > 0) {
      await loadFenceItems();
    }
    return;
  }

  if (files.length > 0) {
    // ── Cas fichiers externes (explorateur / bureau / navigateur web)
    for (const f of files) {
      try {
        if (f.path && f.path.trim() !== '') {
          const realName = f.path.split(/[\\/]/).pop() || f.name;
          await window.api.copyToFence(currentFenceId, f.path, realName);
          await window.api.moveOriginalToBoxFolder(f.path, currentFenceId);
        } else {
          const buffer = await f.arrayBuffer();
          await window.api.writeBufferToFence(currentFenceId, f.name, buffer);
        }
      } catch (err) {
        alert('Impossible de copier : ' + f.name + '\n' + (err?.message ?? err));
      }
    }
    await loadFenceItems();
  }
});

// ───────────────────────────────────────────────
// Anti‑doublon ouverture
// ───────────────────────────────────────────────

const openingGuard = new Map();

const selectedItems = new Set();
let lastSelectedPath = null;

function clearSelection() {
  selectedItems.clear();
  refreshSelectionUI();
}

function selectOnly(filePath) {
  selectedItems.clear();
  selectedItems.add(filePath);
  lastSelectedPath = filePath;
  refreshSelectionUI();
}

function toggleSelection(filePath) {
  if (selectedItems.has(filePath)) selectedItems.delete(filePath);
  else selectedItems.add(filePath);
  lastSelectedPath = filePath;
  refreshSelectionUI();
}

function refreshSelectionUI() {
  container.querySelectorAll('.icon').forEach(el => {
    const fp = el.dataset.fullPath;
    el.classList.toggle('selected', selectedItems.has(fp));
  });
}

async function deleteSelectedItems() {
  const paths = Array.from(selectedItems);
  if (!paths.length) return;

  const label = paths.length === 1
    ? `Supprimer "${getDisplayName(paths[0])}" ?\nL'élément sera envoyé à la corbeille.`
    : `Supprimer ${paths.length} éléments ?\nLes éléments seront envoyés à la corbeille.`;

  if (!(await showConfirmDialog(label))) return;

  for (const p of paths) {
    try { await window.api.trashItem(p); } catch {}
  }
  clearSelection();
  await loadFenceItems();
}
function openOnce(filePath) {
  const now = Date.now();
  const last = openingGuard.get(filePath) ?? 0;
  if (now - last < 800) return;
  openingGuard.set(filePath, now);
  window.api.openFile(filePath);
}

window.addEventListener('keydown', async (e) => {
  const activeTag = document.activeElement?.tagName;
  const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;
  if (isTyping) return;

  if (e.key === 'Delete') {
    if (document.querySelector('.ctx')) return; // le menu gère déjà Delete
    e.preventDefault();
    await deleteSelectedItems();
  } else if (e.key === 'Enter' && selectedItems.size === 1) {
    e.preventDefault();
    openOnce(Array.from(selectedItems)[0]);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    container.querySelectorAll('.icon').forEach(el => selectedItems.add(el.dataset.fullPath));
    refreshSelectionUI();
  } else if (e.key === 'Escape') {
    clearSelection();
  }
});

// ───────────────────────────────────────────────
// Menu contextuel
// ───────────────────────────────────────────────

function showContextMenu(filePath, x, y) {
  // Fermer tout menu déjà ouvert (un clic droit ne déclenche pas 'click')
  document.querySelectorAll('.ctx').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'ctx';
  menu.innerHTML = `
    <button data-act="open">Ouvrir</button>
    <button data-act="reveal">Ouvrir le dossier</button>
    <button data-act="extract-copy">📋 Copier sur le bureau</button>
    <button data-act="extract-move">↗ Déplacer sur le bureau</button>
    <button data-act="rename">Renommer</button>
    <button data-act="change-icon">🖼️ Changer l'icône…</button>
    <button data-act="reset-icon">↺ Réinitialiser l'icône</button>
    <button data-act="delete">Supprimer</button>
  `;
  document.body.appendChild(menu);

  // Repositionner après insertion pour connaître la taille réelle du menu
  const mw = menu.offsetWidth || 210;
  const mh = menu.offsetHeight || 190;
  const left = (x + mw > window.innerWidth) ? window.innerWidth - mw - 4 : x;
  const top = (y + mh > window.innerHeight) ? window.innerHeight - mh - 4 : y;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  const close = () => menu.remove();
  // Fermer sur clic gauche OU clic droit ailleurs
  setTimeout(() => {
    window.addEventListener('click', close, { once: true });
    window.addEventListener('contextmenu', close, { once: true });
  }, 0);

  menu.addEventListener('click', async (ev) => {
    const act = ev.target?.getAttribute('data-act');
    if (!act) return;
    ev.stopPropagation();

    switch (act) {
      case 'open': window.api.openFile(filePath); break;
      case 'reveal': window.api.revealInFolder(filePath); break;

      case 'extract-copy': {
        const res = await window.api.extractToDesktop(filePath, false);
        if (!res?.ok) alert('Impossible de copier sur le bureau :\n' + (res?.error ?? 'Erreur inconnue'));
        break;
      }
      case 'extract-move': {
        const res = await window.api.extractToDesktop(filePath, true);
        if (res?.ok) { await loadFenceItems(); }
        else alert('Impossible de déplacer sur le bureau :\n' + (res?.error ?? 'Erreur inconnue'));
        break;
      }

      case 'rename': {
        const old = filePath.split(/[\\/]/).pop();
        const newName = await showInputDialog('Renommer', 'Nouveau nom', old);
        if (newName && newName !== old) {
          await window.api.renameInFence(filePath, newName);
          await loadFenceItems();
        }
        break;
      }

      case 'change-icon': {
        close();
        try {
          const filePath2 = await window.api.pickIconFile();
          if (!filePath2) return;
          const buffer = await window.api.readFileAsBuffer(filePath2);
          if (!buffer) return;
          const result = await window.api.setCustomIcon(filePath, buffer);
          if (result?.ok) {
            await loadFenceItems();
          } else {
            alert('Impossible d\'enregistrer l\'icône :\n' + (result?.error ?? 'Erreur inconnue'));
          }
        } catch (e) {
          alert('Erreur : ' + e.message);
        }
        return;
      }

      case 'reset-icon': {
        await window.api.removeCustomIcon(filePath);
        await loadFenceItems();
        break;
      }

      case 'delete':
        close(); // ← fermer le menu D'ABORD
        if (await showConfirmDialog(`Supprimer "${getDisplayName(filePath)}" ?\nL'élément sera envoyé à la corbeille.`)) {
          await window.api.trashItem(filePath);
          await loadFenceItems();
        }
        break;
    }
    close();
  });
}

// ───────────────────────────────────────────────
// Rendu des éléments
// ───────────────────────────────────────────────

// ── Style (couleur + opacité) ────────────────────────
function applyStyle({ color, opacity }) {
  const container = document.getElementById('container');
  // Convertir hex en rgb
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  container.style.background = `rgba(${r},${g},${b},${opacity})`;
  // Adapter aussi la titlebar
  document.getElementById('titlebar').style.background =
    `rgba(${Math.max(0, r - 15)},${Math.max(0, g - 15)},${Math.max(0, b - 15)},${Math.min(1, opacity + 0.2)})`;
}

function applyIconSize(size) {
  document.documentElement.style.setProperty('--icon-size', size + 'px');
  // Force reflow immédiat de la grille
  container.style.gridTemplateColumns = `repeat(auto-fill, ${size + 16}px)`;
}

function buildStyleMenu() {
  const actionsEl = document.querySelector('#titlebar .actions');
  if (!actionsEl || actionsEl.dataset.styleBuilt) return;
  actionsEl.dataset.styleBuilt = '1';

  // Bouton palette 🎨
  const btn = document.createElement('button');
  btn.className = 'sort-btn';
  btn.title = 'Apparence';
  btn.textContent = '🎨';
  // Insérer AVANT le bouton de tri
  actionsEl.insertBefore(btn, actionsEl.firstChild);

  // Panel flottant
  const panel = document.createElement('div');
  panel.className = 'style-panel';
  panel.innerHTML = `
    <div class="style-panel-title">Apparence</div>

    <div class="style-row">
      <label>Couleur</label>
      <div class="color-presets">
        <button class="color-swatch" data-color="#1e1e1e" style="background:#1e1e1e" title="Sombre"></button>
        <button class="color-swatch" data-color="#0d1b2a" style="background:#0d1b2a" title="Marine"></button>
        <button class="color-swatch" data-color="#1a1a2e" style="background:#1a1a2e" title="Nuit"></button>
        <button class="color-swatch" data-color="#1b2838" style="background:#1b2838" title="Acier"></button>
        <button class="color-swatch" data-color="#2d1b1b" style="background:#2d1b1b" title="Bordeaux"></button>
        <button class="color-swatch" data-color="#1b2d1b" style="background:#1b2d1b" title="Forêt"></button>
        <button class="color-swatch" data-color="#2a1f0e" style="background:#2a1f0e" title="Café"></button>
        <button class="color-swatch" data-color="#1e1e3a" style="background:#1e1e3a" title="Violet"></button>
        <input type="color" class="color-custom" title="Couleur personnalisée" />
      </div>
    </div>

    <div class="style-row">
      <label>Opacité <span class="opacity-val"></span></label>
      <input type="range" class="opacity-slider" min="0.1" max="1" step="0.05" />
    </div>

    <div class="style-row" style="margin-bottom:4px">
      <label style="justify-content:space-between;align-items:center;display:flex">
        <span>Afficher les extensions</span>
        <label class="ext-toggle-wrap">
          <input type="checkbox" class="ext-toggle-input" />
          <span class="ext-toggle-track"><span class="ext-toggle-thumb"></span></span>
        </label>
      </label>
    </div>

    <div class="style-row" style="margin-bottom:4px">
      <label style="justify-content:space-between;align-items:center;display:flex">
        <span>Ranger le bureau</span>
        <label class="ext-toggle-wrap">
          <input type="checkbox" class="auto-organize-input" />
          <span class="ext-toggle-track"><span class="ext-toggle-thumb"></span></span>
        </label>
      </label>
      <div style="font-size:10px;color:#888;margin-top:2px">Déplace les originaux du bureau dans un dossier du nom de la box</div>
    </div>
  `;
  panel.style.display = 'none';
  document.body.appendChild(panel);

  const opacitySlider = panel.querySelector('.opacity-slider');
  const opacityVal = panel.querySelector('.opacity-val');
  const colorCustom = panel.querySelector('.color-custom');

  // Initialiser avec le style courant
  opacitySlider.value = currentStyle.opacity;
  opacityVal.textContent = Math.round(currentStyle.opacity * 100) + '%';
  colorCustom.value = currentStyle.color;

  // Marquer la swatch active
  function updateActiveSwatch(color) {
    panel.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === color);
    });
  }
  updateActiveSwatch(currentStyle.color);

  async function saveStyle() {
    await window.api.setFenceStyle(currentFenceId, currentStyle.color, currentStyle.opacity);
    applyStyle(currentStyle);
    opacityVal.textContent = Math.round(currentStyle.opacity * 100) + '%';
  }

  // Clic sur une swatch
  panel.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', async () => {
      currentStyle.color = s.dataset.color;
      colorCustom.value = s.dataset.color;
      updateActiveSwatch(s.dataset.color);
      await saveStyle();
    });
  });

  // Couleur custom
  colorCustom.addEventListener('input', async () => {
    currentStyle.color = colorCustom.value;
    updateActiveSwatch(colorCustom.value);
    await saveStyle();
  });

  // Opacité
  opacitySlider.addEventListener('input', async () => {
    currentStyle.opacity = parseFloat(opacitySlider.value);
    await saveStyle();
  });

  // Toggle extensions
  const extToggle = panel.querySelector('.ext-toggle-input');
  extToggle.checked = currentShowExtensions;
  extToggle.addEventListener('change', async () => {
    currentShowExtensions = extToggle.checked;
    // setFenceShowExtensions déclenche onShowExtensionsChanged qui appelle loadFenceItems
    await window.api.setFenceShowExtensions(currentFenceId, currentShowExtensions);
  });

  // Toggle auto-organisation bureau
  const autoOrganizeToggle = panel.querySelector('.auto-organize-input');
  window.api.getAutoOrganizeDesktop().then(v => { autoOrganizeToggle.checked = v; });
  autoOrganizeToggle.addEventListener('change', async () => {
    await window.api.setAutoOrganizeDesktop(autoOrganizeToggle.checked);
  });

  // Toggle panel
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    panel.style.right = (window.innerWidth - r.right) + 'px';
    panel.style.top = (r.bottom + 4) + 'px';
    panel.style.left = 'auto';
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  window.addEventListener('click', () => { panel.style.display = 'none'; });
}

// ── Menu de tri ──────────────────────────────────
function buildSortMenu() {
  const actionsEl = document.querySelector('#titlebar .actions');
  if (!actionsEl || actionsEl.dataset.sortBuilt) return;
  actionsEl.dataset.sortBuilt = '1';

  const btn = document.createElement('button');
  btn.className = 'sort-btn';
  btn.title = 'Trier';
  btn.textContent = '⇅';
  actionsEl.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'sort-menu';
  menu.innerHTML = `
    <button data-sort="name">Nom</button>
    <button data-sort="type">Type</button>
    <button data-sort="date">Date</button>
    <button data-sort="none">Ordre original</button>
  `;
  menu.style.display = 'none';
  document.body.appendChild(menu);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    // Aligner le bord droit du menu sur le bord droit du bouton
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - r.right) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  });

  menu.addEventListener('click', async (e) => {
    const s = e.target.dataset.sort;
    if (!s) return;
    if (s === sortMode && s !== 'none') {
      sortAsc = !sortAsc; // inverser si même tri
    } else {
      sortMode = s;
      sortAsc = true;
    }
    menu.style.display = 'none';
    // Mettre à jour l'indicateur visuel
    menu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    await loadFenceItems();
  });

  window.addEventListener('click', () => { menu.style.display = 'none'; });
}

async function sortItems(items) {
  // En mode 'none', appliquer l'ordre manuel sauvegardé
  if (sortMode === 'none') {
    if (manualOrder.length === 0) return items;
    const ordered = [];
    const byBasename = new Map(items.map(p => [p.split(/[\\/]/).pop(), p]));
    for (const name of manualOrder) {
      if (byBasename.has(name)) {
        ordered.push(byBasename.get(name));
        byBasename.delete(name);
      }
    }
    // Les nouveaux fichiers (pas encore dans manualOrder) à la fin
    for (const p of byBasename.values()) ordered.push(p);
    return ordered;
  }

  const infos = await Promise.all(items.map(async p => {
    try {
      const stat = await window.api.getFileStat(p);
      return { path: p, name: getDisplayName(p).toLowerCase(), ext: p.split('.').pop().toLowerCase(), mtime: stat?.mtime ?? 0 };
    } catch {
      return { path: p, name: getDisplayName(p).toLowerCase(), ext: '', mtime: 0 };
    }
  }));

  infos.sort((a, b) => {
    let cmp = 0;
    if (sortMode === 'name') cmp = a.name.localeCompare(b.name);
    if (sortMode === 'type') cmp = a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name);
    if (sortMode === 'date') cmp = b.mtime - a.mtime;
    return sortAsc ? cmp : -cmp;
  });

  return infos.map(i => i.path);
}

async function loadFenceItems() {
  if (!currentFenceId) return;

  // Supprimer uniquement les icônes et le placeholder, pas les poignées
  container.querySelectorAll('.icon, .empty-placeholder').forEach(el => el.remove());

  let items = await window.api.listFenceItems(currentFenceId);
  items = await sortItems(items);

  // ── Placeholder si box vide ──
  if (items.length === 0) {
    const ph = document.createElement('div');
    ph.className = 'empty-placeholder';
    ph.textContent = 'Glissez des fichiers ici';
    const resizeBr = document.getElementById('resize-br');
    if (resizeBr) container.insertBefore(ph, resizeBr);
    else container.appendChild(ph);
    return;
  }

  // Insérer les icônes AVANT les poignées de redimensionnement
  const resizeBottom = document.getElementById('resize-bottom');

  // ── Variables pour le drag de réorganisation interne ──
  let dragSrcPath = null;
  let dragSrcPaths = []; // multi-sélection

  for (const fullPath of items) {
    const div = document.createElement('div');
    div.className = 'icon';
    div.dataset.fullPath = fullPath;
    const sz = currentIconSize;
    div.style.width = (sz + 16) + 'px';

    const img = document.createElement('img');
    img.style.width = sz + 'px';
    img.style.height = sz + 'px';

    let dataURL = null;

    // DEBUG: voir le chemin et la branche d'icone utilisee
    const isLnk = /\.lnk$/i.test(fullPath);

    // ── Raccourcis .lnk
    if (isLnk) {
      dataURL = await window.api.getFileIconLarge(fullPath);
      if (!dataURL) dataURL = await window.api.getFileIcon(fullPath);
    }
    // ── Fichiers .url
    else if (/\.url$/i.test(fullPath)) {
      dataURL = await window.api.getFileIcon(fullPath);
      const url = await window.api.getUrlFromFile(fullPath);
      if (url) {
        try {
          const urlObj = new URL(url);
          const domain = urlObj.hostname.replace('www.', '');
          const firstLetter = domain.charAt(0).toUpperCase();
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            hash = domain.charCodeAt(i) + ((hash << 5) - hash);
          }
          const hue = Math.abs(hash % 360);
          const svg = `<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="8" fill="hsl(${hue}, 60%, 50%)"/>
            <text x="24" y="34" text-anchor="middle" font-size="24" font-weight="bold" fill="white" font-family="Arial">${firstLetter}</text>
          </svg>`;
          if (!dataURL) dataURL = 'data:image/svg+xml;base64,' + btoa(svg);
        } catch (e) {
        }
      }
    }
    // ── Images : miniature native
    else if (/\.(jpe?g|png|gif|bmp|webp|avif)$/i.test(fullPath)) {
      dataURL = await window.api.getFilePreview(fullPath);
      if (!dataURL) dataURL = await window.api.readImageAsDataURL(fullPath);
    }
    // ── PDF, Adobe, Office et autres formats riches
    else if (/\.(pdf|indd|indt|ai|psd|psb|eps|prproj|aep|xd|docx|doc|xlsx|xls|pptx|ppt|odt|ods|odp|rtf|svg|mp4|mov|avi|mkv|wmv|mp3|flac|wav)$/i.test(fullPath)) {
      dataURL = await window.api.getFilePreview(fullPath);
      if (!dataURL) dataURL = await window.api.getFileIconLarge(fullPath);
      if (!dataURL) dataURL = await window.api.getFileIcon(fullPath);
    }
    // ── Tous les autres fichiers
    else {
      dataURL = await window.api.getFileIconLarge(fullPath);
      if (!dataURL) dataURL = await window.api.getFileIcon(fullPath);
    }

    if (!dataURL) dataURL = await window.api.getFileIcon(fullPath);
    if (dataURL) img.src = dataURL;

    const label = document.createElement('div');
    label.className = 'name';
    label.textContent = getDisplayName(fullPath);

    // Tooltip : nom de fichier complet avec extension (sans le chemin)
    div.title = fullPath.split(/[\\/]/).pop();

    div.draggable = true;

    // ── Drag START
    div.addEventListener('dragstart', async (e) => {
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', fullPath);
        window.__interFenceDrag = false;
        div._dropHandled = false;

        // Utiliser l'icône du fichier comme fantôme de drag
        const img = div.querySelector('img');
        if (img) {
          const size = img.naturalWidth || img.width || 48;
          e.dataTransfer.setDragImage(img, size / 2, size / 2);
        }

        // Multi-sélection : si l'élément draggé fait partie de la sélection,
        // on drag tous les sélectionnés ; sinon on sélectionne uniquement celui-ci
        if (selectedItems.has(fullPath) && selectedItems.size > 1) {
          dragSrcPaths = Array.from(selectedItems);
        } else {
          selectOnly(fullPath);
          dragSrcPaths = [fullPath];
        }
        dragSrcPath = fullPath;

        // Marquer tous les éléments draggés
        container.querySelectorAll('.icon').forEach(el => {
          if (dragSrcPaths.includes(el.dataset.fullPath)) {
            el.classList.add('dragging');
            el._dropHandled = false;
          }
        });

        // Snapshot des chemins AVANT tout await (la variable dragSrcPaths peut changer)
        const pathsSnapshot = [...dragSrcPaths];

        // ⚠️ Enregistrer le listener dragleave AVANT le await fenceDragStart.
        // Si on attend la réponse IPC, dragleave peut avoir déjà tiré (mouse quitte
        // la fenêtre pendant le round-trip) et nativeDragStart ne serait jamais appelé.
        const onDocLeave = (ev) => {
          if (ev.relatedTarget) return;
          document.removeEventListener('dragleave', onDocLeave);
          window.__interFenceDrag = true;
          window.api.nativeDragStart(pathsSnapshot).catch(() => {});
        };
        const onDocDrop = () => {
          document.removeEventListener('dragleave', onDocLeave);
          document.removeEventListener('drop', onDocDrop);
          document.removeEventListener('dragend', onDocDrop);
        };
        document.addEventListener('dragleave', onDocLeave);
        document.addEventListener('drop', onDocDrop, { once: true });
        document.addEventListener('dragend', onDocDrop, { once: true });

        // Enregistrer le drag dans le main process pour inter-fence
        // (après le listener pour éviter la race condition)
        await window.api.fenceDragStart(pathsSnapshot, currentFenceId);

      } catch (err) {
      }
    });

    // ── Drag OVER sur une icône (indicateur d'insertion avant/après)
    div.addEventListener('dragover', (e) => {
      const isInterFenceOrExternal = !dragSrcPath || !items.includes(dragSrcPath);
      if (isInterFenceOrExternal) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrcPaths.includes(fullPath)) return;

      // Effacer tous les indicateurs existants
      container.querySelectorAll('.icon.insert-before, .icon.insert-after')
        .forEach(el => { el.classList.remove('insert-before'); el.classList.remove('insert-after'); });

      // Avant ou après selon la moitié horizontale de l'icône survolée
      const rect = div.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        div.classList.add('insert-before');
      } else {
        div.classList.add('insert-after');
      }
    });

    // ── Drop sur une icône (réorganisation interne)
    div.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Lire la position (avant/après) AVANT de nettoyer les classes
      const insertBefore = div.classList.contains('insert-before');
      const insertAfter  = div.classList.contains('insert-after');

      container.querySelectorAll('.icon.insert-before, .icon.insert-after')
        .forEach(el => { el.classList.remove('insert-before'); el.classList.remove('insert-after'); });

      if (!dragSrcPath || dragSrcPaths.includes(fullPath)) return;
      if (!items.includes(dragSrcPath)) return;

      div._dropHandled = true;
      container.querySelectorAll('.icon').forEach(el => { el._dropHandled = true; });

      const currentOrder = Array.from(container.querySelectorAll('.icon')).map(el => el.dataset.fullPath);
      const targets = dragSrcPaths;
      const remaining = currentOrder.filter(p => !targets.includes(p));
      let insertIdx = remaining.indexOf(fullPath);
      if (insertIdx === -1) return;
      if (insertAfter) insertIdx += 1; // insérer après
      remaining.splice(insertIdx, 0, ...targets);

      manualOrder = remaining.map(p => p.split(/[\\/]/).pop());
      await window.api.setFenceOrder(currentFenceId, manualOrder);
      await window.api.fenceDragCancel();
      window.__interFenceDrag = false;
      dragSrcPath = null;
      dragSrcPaths = [];
      await loadFenceItems();
    });

    div.addEventListener('dragleave', () => {
      div.classList.remove('insert-before');
      div.classList.remove('insert-after');
    });

    div.addEventListener('dragend', async () => {
      try {
        container.querySelectorAll('.icon.dragging, .icon.drop-target').forEach(el => {
          el.classList.remove('dragging');
          el.classList.remove('drop-target');
        });
        window.__interFenceDrag = false;
        dragSrcPath = null;
        dragSrcPaths = [];
        div._dropHandled = false;
        // NE PAS appeler fenceDragCancel ici — dragend sur la source
        // se déclenche avant (ou pendant) que drop sur la cible s'exécute.
        // draggedItem sera nettoyé par fenceDragDrop ou par le prochain fenceDragStart.
      } catch (err) {
      }
    });

    div.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        toggleSelection(fullPath);
      } else {
        selectOnly(fullPath);
      }
      e.stopPropagation();
    });

    div.addEventListener('dblclick', () => openOnce(fullPath));
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(fullPath, e.clientX, e.clientY);
    });

    div.appendChild(img);
    div.appendChild(label);
    if (resizeBottom) {
      container.insertBefore(div, resizeBottom);
    } else {
      container.appendChild(div);
    }
  }
}


// ───────────────────────────────────────────────
// Sélection rectangle style bureau Windows
// ───────────────────────────────────────────────
let selectionBox = null;
let selectionRectStart = null;
let selectionDragging = false;

function rectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

container.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.icon') || e.target.closest('.ctx') || e.target.closest('#titlebar')) return;

  clearSelection();

  const cRect = container.getBoundingClientRect();
  selectionRectStart = {
    x: e.clientX - cRect.left + container.scrollLeft,
    y: e.clientY - cRect.top + container.scrollTop
  };

  selectionBox = document.createElement('div');
  selectionBox.className = 'selection-box';
  container.appendChild(selectionBox);
  selectionDragging = true;
});

window.addEventListener('mousemove', (e) => {
  if (!selectionDragging || !selectionBox || !selectionRectStart) return;

  const cRect = container.getBoundingClientRect();
  const curX = e.clientX - cRect.left + container.scrollLeft;
  const curY = e.clientY - cRect.top + container.scrollTop;

  const left = Math.min(selectionRectStart.x, curX);
  const top = Math.min(selectionRectStart.y, curY);
  const width = Math.abs(curX - selectionRectStart.x);
  const height = Math.abs(curY - selectionRectStart.y);

  selectionBox.style.left = left + 'px';
  selectionBox.style.top = top + 'px';
  selectionBox.style.width = width + 'px';
  selectionBox.style.height = height + 'px';

  const boxRect = {
    left: cRect.left + left - container.scrollLeft,
    top: cRect.top + top - container.scrollTop,
    right: cRect.left + left + width - container.scrollLeft,
    bottom: cRect.top + top + height - container.scrollTop
  };

  selectedItems.clear();
  container.querySelectorAll('.icon').forEach(el => {
    const r = el.getBoundingClientRect();
    if (rectsIntersect(boxRect, r)) selectedItems.add(el.dataset.fullPath);
  });
  refreshSelectionUI();
});

window.addEventListener('mouseup', () => {
  const wasRectDrag = selectionDragging && selectionBox;
  selectionDragging = false;
  selectionRectStart = null;
  if (selectionBox) {
    selectionBox.remove();
    selectionBox = null;
  }
  // Si on vient de terminer un rectangle de sélection avec des items dedans,
  // on marque l'événement pour que le 'click' qui suit ne vide pas la sélection
  if (wasRectDrag && selectedItems.size > 0) {
    container._justFinishedRectSelect = true;
  }
});

container.addEventListener('click', (e) => {
  // Ne pas effacer si on vient de terminer un rectangle de sélection
  if (container._justFinishedRectSelect) {
    container._justFinishedRectSelect = false;
    return;
  }
  if (e.target === container) clearSelection();
});

// ───────────────────────────────────────────────
// Poignées de redimensionnement
// ───────────────────────────────────────────────

function ensureResizeHandles() {
  // resize-bottom désactivé (ne fonctionne pas sous Windows transparent+frameless)
  if (!document.getElementById('resize-br')) {
    const hbr = document.createElement('div');
    hbr.id = 'resize-br';
    container.appendChild(hbr);
  }
}

ensureResizeHandles();


function startResize(type) {
  // On utilise screenX/Y (coordonnées absolues écran) pour éviter
  // le décalage causé par le redimensionnement de la fenêtre elle-même
  let lastScreenX = null;
  let lastScreenY = null;

  const onMove = (e) => {
    if (lastScreenX === null) {
      lastScreenX = e.screenX;
      lastScreenY = e.screenY;
      return;
    }

    const dx = e.screenX - lastScreenX;
    const dy = e.screenY - lastScreenY;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;

    if (dx !== 0 || dy !== 0) {
      window.api.resizeBy(type, dx, dy);
    }
  };

  const onUp = () => {
    window.api.resizeEnd();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

document.getElementById('resize-br').addEventListener('mousedown', (e) => {
  e.preventDefault();
  startResize('southeast');
});