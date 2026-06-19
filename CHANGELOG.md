# Changelog

## 3.8.0

### Stockage bureau (mode Stardock)
- Fichiers des boxes dans **`Bureau\Boxes\<NomDeLaBox>\`** (migration automatique depuis AppData).
- Dossier `Boxes` **masqué dans l'Explorateur** (Hidden + System).
- **Masquer les icônes Windows** : toggle dans le panneau Apparence (restauré à la fermeture).
- **Auto-organisation** : originaux du bureau rangés dans un sous-dossier au nom de la box.

### Drag & drop
- **Inter-box** : glisser une icône d'une box vers une autre (modèle placeholder stable).
- **Bureau ↔ box** : déplacement quand Windows l'autorise ; copie seule pour le bureau public (EPERM).
- **Dépôt dans un dossier** à l'intérieur d'une box.
- Démarrage drag **synchrone** (`fenceDragStartSync`, `nativeDragStartSync`) pour fiabilité.
- DropTarget OLE **opt-in** (`test.bat ole` / `--native-dnd`) — désactivé par défaut.
- Rafraîchissement UI **sans clignotement** pendant le drag inter-box.

### Module natif (`shell_utils`)
- DropTarget OLE, drag placeholder, masquage icônes bureau ListView.
- Notifications Shell après déplacements.

### Interface & outils
- Panneau Apparence : toggles masquage icônes, auto-organisation.
- Style « glass » modernisé.
- **`test.bat`** : dev (`rebuild`, `legacy`, `ole`), **`build.ps1`**, **`scripts/publish-itch.ps1`**.

### Retraits
- Aperçu temporaire icônes bureau (double-clic / Ctrl+Shift+D) — instable, retiré.

---

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

