const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  const productName = context.packager.appInfo.productName;
  const exePath = path.join(context.appOutDir, productName + '.exe');
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const rcedit = path.join(__dirname, 'rcedit.exe');

  console.log('[afterPack] exe attendu:', exePath);

  if (!fs.existsSync(rcedit)) {
    console.warn('[afterPack] rcedit.exe non trouve');
    return;
  }
  if (!fs.existsSync(exePath)) {
    // Lister ce qui est dans appOutDir pour debug
    const files = fs.readdirSync(context.appOutDir).filter(f => f.endsWith('.exe'));
    console.warn('[afterPack] exe non trouve, exes presents:', files);
    return;
  }

  console.log('[afterPack] Injection icone dans', exePath);
  execSync('"' + rcedit + '" "' + exePath + '" --set-icon "' + iconPath + '"');
  console.log('[afterPack] Icone injectee avec succes');
};
