// manager-renderer.js

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function hasApi(fnName) {
  return !!window.api && typeof window.api[fnName] === 'function';
}

function qs(id) {
  return document.getElementById(id);
}

// ─────────────────────────────────────────────
// Dialogs HTML natifs au manager
// ─────────────────────────────────────────────
function ensureDialogHost() {
  let host = document.getElementById('app-dialog-host');
  if (host) return host;

  host = document.createElement('div');
  host.id = 'app-dialog-host';
  document.body.appendChild(host);
  return host;
}

function closeDialog() {
  const host = document.getElementById('app-dialog-host');
  if (host) host.innerHTML = '';
}

function createDialogShell({
  title = '',
  message = '',
  withInput = false,
  defaultValue = '',
  okText = 'OK',
  cancelText = 'Annuler'
}) {
  const host = ensureDialogHost();

  host.innerHTML = `
    <div class="app-dialog-overlay">
      <div class="app-dialog" role="dialog" aria-modal="true">
        <div class="app-dialog-header">
          <div class="app-dialog-title">${escapeHtml(title)}</div>
          <button class="app-dialog-close" id="app-dialog-close" title="Fermer">✕</button>
        </div>
        <div class="app-dialog-body">
          <div class="app-dialog-message">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
          ${
            withInput
              ? `<input id="app-dialog-input" class="app-dialog-input" type="text" value="${escapeAttr(defaultValue)}" />`
              : ''
          }
        </div>
        <div class="app-dialog-actions">
          <button class="app-dialog-btn secondary" id="app-dialog-cancel">${cancelText}</button>
          <button class="app-dialog-btn primary" id="app-dialog-ok">${okText}</button>
        </div>
      </div>
    </div>
  `;

  return host;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function showAlertDialog(title, message) {
  return new Promise((resolve) => {
    createDialogShell({
      title,
      message,
      withInput: false,
      okText: 'OK',
      cancelText: 'Fermer',
    });

    const okBtn = qs('app-dialog-ok');
    const cancelBtn = qs('app-dialog-cancel');
    const closeBtn = qs('app-dialog-close');

    const done = () => {
      closeDialog();
      resolve();
    };

    okBtn?.addEventListener('click', done);
    cancelBtn?.addEventListener('click', done);
    closeBtn?.addEventListener('click', done);
  });
}

async function showConfirmDialog(message, title = 'Confirmation') {
  return new Promise((resolve) => {
    createDialogShell({
      title,
      message,
      withInput: false,
      okText: 'Continuer',
      cancelText: 'Annuler',
    });

    const okBtn = qs('app-dialog-ok');
    const cancelBtn = qs('app-dialog-cancel');
    const closeBtn = qs('app-dialog-close');

    okBtn?.addEventListener('click', () => {
      closeDialog();
      resolve(true);
    });

    const cancel = () => {
      closeDialog();
      resolve(false);
    };

    cancelBtn?.addEventListener('click', cancel);
    closeBtn?.addEventListener('click', cancel);
  });
}

async function showInputDialog(title, label, defaultValue = '') {
  return new Promise((resolve) => {
    createDialogShell({
      title,
      message: label,
      withInput: true,
      defaultValue,
      okText: 'Valider',
      cancelText: 'Annuler',
    });

    const input = qs('app-dialog-input');
    const okBtn = qs('app-dialog-ok');
    const cancelBtn = qs('app-dialog-cancel');
    const closeBtn = qs('app-dialog-close');

    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 0);

    okBtn?.addEventListener('click', () => {
      const value = input ? input.value : '';
      closeDialog();
      resolve(value);
    });

    const cancel = () => {
      closeDialog();
      resolve(null);
    };

    cancelBtn?.addEventListener('click', cancel);
    closeBtn?.addEventListener('click', cancel);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        okBtn?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
  });
}

// ─────────────────────────────────────────────
// Boot logs
// ─────────────────────────────────────────────
console.log('[manager] démarrage');
console.log('[manager] window.api disponible ?', !!window.api);
console.log('[manager] APIs:', window.api);

// ─────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────
const createBtn = qs('create-btn');
const fenceList = qs('fence-list');
const exportBtn = qs('export-btn');
const importBtn = qs('import-btn');
const autostartBtn = qs('wc-autostart');
const helpOverlay = qs('help-overlay');
const helpBtn = qs('wc-help');
const helpCloseBtn = qs('help-close');
const wcMin = qs('wc-min');
const wcMax = qs('wc-max');
const wcClose = qs('wc-close');
const wcQuit = qs('wc-quit');

// ─────────────────────────────────────────────
// Contrôles fenêtre
// ─────────────────────────────────────────────
if (wcMin && hasApi('managerMinimize')) {
  wcMin.addEventListener('click', () => {
    window.api.managerMinimize().catch(err => console.error('[manager] minimize failed', err));
  });
}

if (wcMax && hasApi('managerToggleMaximize')) {
  wcMax.addEventListener('click', () => {
    window.api.managerToggleMaximize().catch(err => console.error('[manager] maximize failed', err));
  });
}

// Bouton ✕ → masquer dans le tray
if (wcClose && hasApi('managerClose')) {
  wcClose.addEventListener('click', () => {
    window.api.managerClose().catch(err => console.error('[manager] close failed', err));
  });
}

// Bouton ⏻ → quitter complètement
if (wcQuit && hasApi('quitApp')) {
  wcQuit.addEventListener('click', () => {
    window.api.quitApp().catch(err => console.error('[manager] quit failed', err));
  });
}

// ─────────────────────────────────────────────
// Version
// ─────────────────────────────────────────────
(async () => {
  try {
    if (!hasApi('getAppVersion')) return;
    const version = await window.api.getAppVersion();
    const titleEl = document.querySelector('#titlebar .title');
    if (titleEl) titleEl.textContent = `My Boxes v${version}`;
    const helpVersion = qs('help-version');
    if (helpVersion) helpVersion.textContent = `Boxes v${version}`;
  } catch (e) {
    console.warn('[manager] getAppVersion failed', e);
  }
})();

// ─────────────────────────────────────────────
// Autostart
// ─────────────────────────────────────────────
async function refreshAutostartBtn() {
  try {
    if (!autostartBtn || !hasApi('getAutostart')) return;
    const enabled = await window.api.getAutostart();

    autostartBtn.classList.toggle('autostart-on', !!enabled);
    autostartBtn.title = enabled
      ? 'Démarrage automatique : ACTIVÉ — cliquer pour désactiver'
      : 'Démarrage automatique : désactivé — cliquer pour activer';
  } catch (e) {
    console.warn('[autostart] refresh failed', e);
  }
}

if (autostartBtn) {
  autostartBtn.addEventListener('click', async () => {
    try {
      if (!hasApi('getAutostart') || !hasApi('setAutostart')) {
        await showAlertDialog('Fonction indisponible', "Le démarrage automatique n'est pas disponible.");
        return;
      }

      const current = await window.api.getAutostart();
      await window.api.setAutostart(!current);
      await refreshAutostartBtn();
    } catch (e) {
      console.error('[autostart] toggle failed', e);
      await showAlertDialog('Erreur', e.message || String(e));
    }
  });
}

refreshAutostartBtn();

// ─────────────────────────────────────────────
// Help modal
// ─────────────────────────────────────────────
if (helpBtn && helpOverlay) {
  helpBtn.addEventListener('click', () => {
    helpOverlay.style.display = 'flex';
  });
}

if (helpCloseBtn && helpOverlay) {
  helpCloseBtn.addEventListener('click', () => {
    helpOverlay.style.display = 'none';
  });
}

if (helpOverlay) {
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) helpOverlay.style.display = 'none';
  });
}

// ─────────────────────────────────────────────
// Export / Import des icônes
// ─────────────────────────────────────────────
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    try {
      if (!hasApi('exportProfile')) {
        await showAlertDialog('Export impossible', "L'API exportProfile n'est pas disponible.");
        return;
      }

      const res = await window.api.exportProfile();

      if (res?.canceled) return;

      if (!res?.ok) {
        await showAlertDialog('Export impossible', res?.error || 'Erreur inconnue');
        return;
      }

      await showAlertDialog(
        'Export terminé',
        `${res.count ?? 0} icône(s) exportée(s) dans :\n${res.exportPath}`
      );
    } catch (e) {
      console.error('[manager] export failed', e);
      await showAlertDialog('Export impossible', e.message || String(e));
    }
  });
}

if (importBtn) {
  importBtn.addEventListener('click', async () => {
    try {
      if (!hasApi('importProfile')) {
        await showAlertDialog('Import impossible', "L'API importProfile n'est pas disponible.");
        return;
      }

      const ok = await showConfirmDialog(
        'Importer des icônes personnalisées ?\n' +
        'Les icônes du dossier choisi seront copiées dans le profil courant.',
        'Importer des icônes'
      );
      if (!ok) return;

      const res = await window.api.importProfile();

      if (res?.canceled) return;

      if (!res?.ok) {
        await showAlertDialog('Import impossible', res?.error || 'Erreur inconnue');
        return;
      }

      await showAlertDialog(
        'Import terminé',
        `${res.count ?? 0} icône(s) importée(s).`
      );
    } catch (e) {
      console.error('[manager] import failed', e);
      await showAlertDialog('Import impossible', e.message || String(e));
    }
  });
}

// ─────────────────────────────────────────────
// Fences
// ─────────────────────────────────────────────
async function loadFences() {
  console.log('[manager] loadFences appelé');

  try {
    if (!fenceList) {
      console.error('[manager] fenceList introuvable');
      return;
    }

    if (!hasApi('listAllFences')) {
      fenceList.innerHTML = `
        <div style="text-align:center; opacity:0.6; padding:20px; font-size:12px;">
          API listAllFences indisponible
        </div>
      `;
      return;
    }

    const fences = await window.api.listAllFences();
    console.log('[manager] fences récupérées:', fences);

    fenceList.innerHTML = '';

    if (!Array.isArray(fences) || fences.length === 0) {
      fenceList.innerHTML = `
        <div style="text-align:center; opacity:0.5; padding:20px; font-size:12px;">
          Aucune box. Créez-en une !
        </div>
      `;
      return;
    }

    for (const fence of fences) {
      const item = document.createElement('div');
      item.className = 'fence-item';

      const name = document.createElement('div');
      name.className = 'fence-item-name';
      name.textContent = fence?.name || 'Box sans nom';

      const actions = document.createElement('div');
      actions.className = 'fence-item-actions';

      const sizeBtn = document.createElement('button');
      sizeBtn.className = 'fence-action-btn size';
      sizeBtn.title = 'Taille des icônes';
      sizeBtn.textContent = '⊞';

      // Bouton dupliquer
      const dupBtn = document.createElement('button');
      dupBtn.className = 'fence-action-btn dup';
      dupBtn.textContent = '⧉';
      dupBtn.title = 'Dupliquer cette box';

      dupBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!hasApi('duplicateFence')) {
          await showAlertDialog('Fonction indisponible', "L'API duplicateFence n'est pas disponible.");
          return;
        }
        try {
          const result = await window.api.duplicateFence(fence.id);
          if (result) await loadFences();
          else await showAlertDialog('Erreur', 'La duplication a échoué.');
        } catch (err) {
          await showAlertDialog('Erreur', err.message || String(err));
        }
      });

      sizeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (!hasApi('setFenceIconSize')) {
          await showAlertDialog('Fonction indisponible', "L'API setFenceIconSize n'est pas disponible.");
          return;
        }

        document.querySelectorAll('.size-menu').forEach(m => m.remove());

        const sizes = [
          { label: '🔲 Petites (32 px)', value: 32 },
          { label: '⬛ Moyennes (48 px)', value: 48 },
          { label: '🟫 Grandes (128 px)', value: 128 },
        ];

        const menu = document.createElement('div');
        menu.className = 'size-menu';

        const currentSize = fence.iconSize ?? 48;

        for (const s of sizes) {
          const btn = document.createElement('button');
          btn.textContent = s.label;

          if (s.value === currentSize) btn.classList.add('active');

          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            try {
              await window.api.setFenceIconSize(fence.id, s.value);
              fence.iconSize = s.value;
              menu.remove();
            } catch (err) {
              console.error('[manager] setFenceIconSize failed', err);
              await showAlertDialog('Erreur', err.message || String(err));
            }
          });

          menu.appendChild(btn);
        }

        document.body.appendChild(menu);
        const r = sizeBtn.getBoundingClientRect();
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.right = `${window.innerWidth - r.right}px`;
        menu.style.left = 'auto';

        setTimeout(() => {
          window.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'fence-action-btn delete';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Supprimer';

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (!hasApi('deleteFence')) {
          await showAlertDialog('Suppression impossible', "L'API deleteFence n'est pas disponible.");
          return;
        }

        const ok = await showConfirmDialog(
          `Supprimer la box "${fence.name}" ?\nTous les fichiers seront envoyés à la corbeille.`,
          'Supprimer la box'
        );

        if (!ok) return;

        try {
          await window.api.deleteFence(fence.id);
          await loadFences();
        } catch (err) {
          console.error('[manager] deleteFence failed', err);
          await showAlertDialog('Suppression impossible', err.message || String(err));
        }
      });

      actions.appendChild(sizeBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(name);
      item.appendChild(actions);

      item.addEventListener('click', async () => {
        try {
          if (!hasApi('openFence')) {
            await showAlertDialog('Ouverture impossible', "L'API openFence n'est pas disponible.");
            return;
          }
          await window.api.openFence(fence.id);
        } catch (err) {
          console.error('[manager] openFence failed', err);
          await showAlertDialog('Ouverture impossible', err.message || String(err));
        }
      });

      fenceList.appendChild(item);
    }
  } catch (error) {
    console.error('[manager] Erreur dans loadFences:', error);
    if (fenceList) {
      fenceList.innerHTML = `
        <div style="text-align:center; opacity:0.75; padding:20px; font-size:12px;">
          Erreur de chargement : ${escapeHtml(error?.message || String(error))}
        </div>
      `;
    }
  }
}

// ─────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────
if (createBtn) {
  createBtn.addEventListener('click', async () => {
    try {
      if (!hasApi('createNewFence')) {
        await showAlertDialog('Création impossible', "L'API createNewFence n'est pas disponible.");
        return;
      }

      const name = await showInputDialog('Nouvelle Box', 'Nom de la Box', 'Nouvelle Box');
      if (name == null) return;

      const finalName = String(name).trim();
      if (!finalName) return;

      await window.api.createNewFence(finalName);
      await loadFences();
    } catch (error) {
      console.error('[manager] create failed', error);
      await showAlertDialog('Erreur lors de la création', error.message || String(error));
    }
  });
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
loadFences().catch(err => {
  console.error('[manager] loadFences fatal', err);
});