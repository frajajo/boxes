# Changelog

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

