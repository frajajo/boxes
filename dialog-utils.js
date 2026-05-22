// dialog-utils.js - Dialogues personnalisés

// ── Injection du style partagé (une seule fois) ──────────────────
(function injectDialogStyles() {
  if (document.getElementById('dialog-utils-style')) return;
  const style = document.createElement('style');
  style.id = 'dialog-utils-style';
  style.textContent = `
    .du-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      animation: du-fade-in 120ms ease forwards;
    }

    @keyframes du-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .du-modal {
      background: rgba(22, 22, 32, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow:
        0 24px 60px rgba(0, 0, 0, 0.6),
        0 0 0 1px rgba(255,255,255,0.04) inset;
      padding: 24px 24px 20px;
      min-width: 280px;
      max-width: 360px;
      width: calc(100vw - 48px);
      max-height: calc(100vh - 80px);
      overflow: auto;
      animation: du-slide-in 160ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif;
    }

    @keyframes du-slide-in {
      from { opacity: 0; transform: scale(0.92) translateY(8px); }
      to   { opacity: 1; transform: scale(1)    translateY(0);   }
    }

    .du-icon {
      font-size: 28px;
      line-height: 1;
      margin-bottom: 12px;
      display: block;
    }

    .du-title {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 8px 0;
      letter-spacing: 0.01em;
    }

    .du-message {
      font-size: 12.5px;
      color: rgba(255, 255, 255, 0.65);
      line-height: 1.55;
      margin: 0 0 20px 0;
      white-space: pre-wrap;
    }

    .du-input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 7px;
      padding: 9px 12px;
      font-size: 13px;
      color: #fff;
      outline: none;
      margin-bottom: 18px;
      transition: border-color 150ms, box-shadow 150ms;
      font-family: inherit;
    }

    .du-input:focus {
      border-color: rgba(102, 170, 255, 0.6);
      box-shadow: 0 0 0 3px rgba(102, 170, 255, 0.15);
    }

    .du-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      position: sticky;
      bottom: 0;
      background: rgba(22, 22, 32, 0.98);
      padding-top: 10px;
      margin-top: -4px;
    }

    .du-btn {
      all: unset;
      padding: 7px 18px;
      border-radius: 7px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms, transform 80ms;
      font-family: inherit;
    }

    .du-btn:active {
      transform: scale(0.96);
    }

    .du-btn-cancel {
      background: rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .du-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.85);
    }

    .du-btn-ok {
      background: rgba(102, 170, 255, 0.2);
      color: #88bbff;
      border: 1px solid rgba(102, 170, 255, 0.35);
    }

    .du-btn-ok:hover {
      background: rgba(102, 170, 255, 0.32);
      color: #aaccff;
    }

    .du-btn-danger {
      background: rgba(255, 80, 80, 0.18);
      color: #ff8888;
      border: 1px solid rgba(255, 80, 80, 0.3);
    }

    .du-btn-danger:hover {
      background: rgba(255, 80, 80, 0.3);
      color: #ffaaaa;
    }

    .du-divider {
      height: 1px;
      background: rgba(255,255,255,0.07);
      margin: 0 0 18px 0;
    }
  `;
  document.head.appendChild(style);
})();

function _duEnsureDialogVisible(overlay) {
  try {
    document.body.classList.add('du-modal-open');
    // Après rendu, calculer la taille nécessaire pour afficher le dialog complet.
    requestAnimationFrame(() => {
      try {
        const modal = overlay?.querySelector?.('.du-modal');
        if (!modal) return;
        // scrollHeight = hauteur totale du contenu, non tronquée par max-height CSS
        const fullH = modal.scrollHeight;
        const fullW = modal.getBoundingClientRect().width;
        const curW = window.innerWidth || 0;
        const curH = window.innerHeight || 0;

        // Hauteur = contenu + titlebar (28px) + marges de centrage overlay (52px)
        const wantH = Math.max(280, Math.ceil(fullH + 80));
        const wantW = Math.max(360, Math.ceil(fullW + 48));

        const growH = Math.max(0, wantH - curH);
        const growW = Math.max(0, wantW - curW);

        // Hauteur : setContentHeight gère le trick DWM et les fences verrouillées.
        // Si la fenêtre est trop basse dans l'écran, la remonter d'abord.
        if (growH > 0 && window?.api?.setContentHeight) {
          const screenY   = window.screenY || 0;
          const availH    = screen.availHeight || 1080;
          const bottomAfterGrow = screenY + wantH;
          if (bottomAfterGrow > availH) {
            const dy = availH - wantH - screenY; // négatif = monter
            window.api.moveWindow?.(0, dy);
          }
          window.api.setContentHeight(wantH);
        }
        // Largeur : resizeBy si nécessaire (cas rare — dialog plus large que la box)
        if (growW > 0 && window?.api?.resizeBy) {
          window.api.resizeBy('southeast', growW, 0).catch?.(() => {});
        }
      } catch {}
    });
  } catch {}
}

function _duCleanupDialogState() {
  try {
    if (!document.querySelector('.du-overlay')) {
      document.body.classList.remove('du-modal-open');
    }
  } catch {}
}


// ── Échappement HTML (protection XSS) ────────────────────────────
function _duEscapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ── showInputDialog ──────────────────────────────────────────────
function showInputDialog(title, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'du-overlay';
    overlay.innerHTML = `
      <div class="du-modal">
        <div class="du-title">${_duEscapeHtml(title)}</div>
        <div class="du-divider"></div>
        <input class="du-input" type="text" placeholder="${_duEscapeHtml(placeholder)}" value="${_duEscapeHtml(defaultValue)}" spellcheck="false" />
        <div class="du-buttons">
          <button class="du-btn du-btn-cancel" id="du-cancel">Annuler</button>
          <button class="du-btn du-btn-ok"     id="du-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _duEnsureDialogVisible(overlay);

    const input = overlay.querySelector('.du-input');
    input.focus();
    input.select();

    const handleOk = () => {
      const value = input.value.trim();
      overlay.remove();
      _duCleanupDialogState();
      resolve(value || null);
    };

    const handleCancel = () => {
      overlay.remove();
      _duCleanupDialogState();
      resolve(null);
    };

    overlay.querySelector('#du-ok').addEventListener('click', handleOk);
    overlay.querySelector('#du-cancel').addEventListener('click', handleCancel);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  handleOk();
      if (e.key === 'Escape') handleCancel();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleCancel();
    });
  });
}


// ── showConfirmDialog ────────────────────────────────────────────
function showConfirmDialog(message, { danger = false, icon = null } = {}) {
  return new Promise((resolve) => {
    // Séparer titre (première ligne) et corps du message
    const lines   = message.split('\n');
    const title   = _duEscapeHtml(lines[0]);
    const body    = _duEscapeHtml(lines.slice(1).join('\n').trim());
    const iconHtml = icon ? `<span class="du-icon">${_duEscapeHtml(icon)}</span>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'du-overlay';
    overlay.innerHTML = `
      <div class="du-modal">
        ${iconHtml}
        <div class="du-title">${title}</div>
        ${body ? `<div class="du-message">${body}</div>` : '<div style="height:16px"></div>'}
        <div class="du-buttons">
          <button class="du-btn du-btn-cancel" id="du-cancel">Non</button>
          <button class="du-btn ${danger ? 'du-btn-danger' : 'du-btn-ok'}" id="du-ok">Oui</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _duEnsureDialogVisible(overlay);

    const handleOk = () => { overlay.remove(); _duCleanupDialogState(); resolve(true);  };
    const handleCancel = () => { overlay.remove(); _duCleanupDialogState(); resolve(false); };

    overlay.querySelector('#du-ok').addEventListener('click', handleOk);
    overlay.querySelector('#du-cancel').addEventListener('click', handleCancel);

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Enter')  { handleOk();     document.removeEventListener('keydown', onKey); }
      if (e.key === 'Escape') { handleCancel(); document.removeEventListener('keydown', onKey); }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleCancel();
    });
  });
}