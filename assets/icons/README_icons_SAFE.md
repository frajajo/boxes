
# Fences Lite — Pack d’icônes SAFE

Ce pack contient des icônes PNG 128×128 prêtes à l’emploi pour Word, Excel, PowerPoint, Thorium et Impero.

## Installation
1. Dézippez ce dossier à la racine de votre projet (vous devez obtenir `assets/icons/*.png`).
2. Ajoutez dans `main.js` une résolution d’icônes personnalisées (voir snippet ci-dessous).
3. Vous pouvez remplacer ces PNG par les icônes officielles si vous les possédez (conservez les mêmes noms de fichiers).

## Noms de fichiers
- assets/icons/word.png
- assets/icons/excel.png
- assets/icons/ppt.png
- assets/icons/thorium.png
- assets/icons/impero.png

## Snippet main.js (à adapter)

const path = require('path');
const { nativeImage } = require('electron');
const ICON_DIR = path.join(__dirname, 'assets', 'icons');
const ICON_PRESETS = {
  'WINWORD.EXE':  'word.png',
  'EXCEL.EXE':    'excel.png',
  'POWERPNT.EXE': 'ppt.png',
  'THORIUM.EXE':  'thorium.png',
  'IMPEROCONSOLE.EXE': 'impero.png'
};

function getCustomIconForExe(exePath) {
  try {
    const exeName = require('path').basename(exePath).toUpperCase();
    const file = ICON_PRESETS[exeName];
    if (!file) return null;
    const p = require('path').join(ICON_DIR, file);
    const img = nativeImage.createFromPath(p);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch { return null; }
}

// Exemple d’usage dans get-file-icon / get-file-icon-large avant app.getFileIcon
// if (/\.exe$/i.test(filePath)) {
//   const custom = getCustomIconForExe(filePath);
//   if (custom) return custom;
// }

