let currentFenceId = null;
let currentStyle = { color: '#1e1e1e', opacity: 0.6 };

const opacitySlider = document.querySelector('.opacity-slider');
const opacityVal = document.querySelector('.opacity-val');
const colorCustom = document.querySelector('.color-custom');
const closeBtn = document.querySelector('.style-panel-close');

function updateActiveSwatch(color) {
  document.querySelectorAll('.color-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color === color);
  });
}

async function saveStyle() {
  await window.api.setFenceStyle(currentFenceId, currentStyle.color, currentStyle.opacity);
  opacityVal.textContent = Math.round(currentStyle.opacity * 100) + '%';
}

function closePanel() {
  window.api.closeStylePanel();
}

document.querySelectorAll('.color-swatch').forEach((s) => {
  s.addEventListener('click', async () => {
    currentStyle.color = s.dataset.color;
    colorCustom.value = s.dataset.color;
    updateActiveSwatch(s.dataset.color);
    await saveStyle();
  });
});

colorCustom.addEventListener('input', async () => {
  currentStyle.color = colorCustom.value;
  updateActiveSwatch(colorCustom.value);
  await saveStyle();
});

opacitySlider.addEventListener('input', async () => {
  currentStyle.opacity = parseFloat(opacitySlider.value);
  await saveStyle();
});

const extToggle = document.querySelector('.ext-toggle:not(.auto-organize-input)');
extToggle.addEventListener('change', async () => {
  await window.api.setFenceShowExtensions(currentFenceId, extToggle.checked);
});

const autoOrganizeToggle = document.querySelector('.auto-organize-input');
autoOrganizeToggle.addEventListener('change', async () => {
  await window.api.setAutoOrganizeDesktop(autoOrganizeToggle.checked);
});

closeBtn.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

(async () => {
  currentFenceId = await window.api.getCurrentFenceId();
  if (!currentFenceId) return;

  const fenceInfo = await window.api.getFenceInfo(currentFenceId);
  if (fenceInfo?.style) currentStyle = { ...fenceInfo.style };

  opacitySlider.value = currentStyle.opacity;
  opacityVal.textContent = Math.round(currentStyle.opacity * 100) + '%';
  colorCustom.value = currentStyle.color;
  updateActiveSwatch(currentStyle.color);

  if (typeof fenceInfo?.showExtensions === 'boolean') {
    extToggle.checked = fenceInfo.showExtensions;
  }

  autoOrganizeToggle.checked = await window.api.getAutoOrganizeDesktop();
})();
