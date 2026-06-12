# Changelog

## 3.4.48

### Apparence
- Fenêtre **Apparence** en popup dédiée (260×360 px), centrée sur la box, taille fixe.
- Repositionnement automatique pour rester entièrement visible à l’écran (croix ✕ accessible).
- Fermeture via ✕ ou **Échap** ; la box se met à jour en direct (couleur, opacité, extensions, rangement bureau).

### Build & déploiement
- **`build.bat`** : arrêt de Boxes, compilation, installateur silencieux (`/S`), lancement automatique.
- Scripts PowerShell : `scripts/dist.ps1`, `scripts/stop-for-build.ps1`, `scripts/open-build-output.ps1`.
- Sortie dans `build/` avec repli `build-YYYYMMDD-HHMMSS` si le dossier est verrouillé.

### Fichiers ajoutés
- `style-panel.html`, `style-panel-renderer.js` — fenêtre apparence autonome.

---

## 3.4.39

### Nouveautés / améliorations
- Expérimentation Drag & Drop (OLE) activable via `--stardock-dnd-experiment` (désactivé par défaut).
- Démarrage du drag natif côté renderer via IPC asynchrone (`invoke`) au lieu de `sendSync`.
- Ajout du module natif `shell_utils` (Node-API) pour:
  - drag & drop OLE (CF_HDROP)
  - enregistrement/revocation d’un DropTarget OLE
  - notifications Shell (create/delete/update/refresh desktop)
  - récupération d’icônes (PNG/RGBA) via API Shell

### Notes
- Cette version inclut des artefacts de build (binaires `.node`) tels que présents dans l’arborescence au moment de la publication.

