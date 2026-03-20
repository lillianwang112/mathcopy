// popup.js — Read and write extension preferences.

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  enabled: true,
  delimiterStyle: 'dollar',
  displaySpacing: 'newlines',
};

// Elements
const enabledToggle   = document.getElementById('enabled-toggle');
const settingsEl      = document.getElementById('settings');
const statusMsg       = document.getElementById('status-msg');
const delimiterRadios = document.querySelectorAll('input[name="delimiter"]');
const spacingRadios   = document.querySelectorAll('input[name="displaySpacing"]');

// ---------------------------------------------------------------------------
// Load saved preferences and render the UI
// ---------------------------------------------------------------------------

api.storage.sync.get(Object.keys(DEFAULTS), (stored) => {
  const prefs = { ...DEFAULTS, ...stored };

  enabledToggle.checked = prefs.enabled;
  settingsEl.classList.toggle('disabled', !prefs.enabled);

  delimiterRadios.forEach(r => { r.checked = r.value === prefs.delimiterStyle; });
  spacingRadios.forEach(r => { r.checked = r.value === prefs.displaySpacing; });
});

// ---------------------------------------------------------------------------
// Persist a single key and flash a confirmation
// ---------------------------------------------------------------------------

function save(key, value) {
  api.storage.sync.set({ [key]: value }, () => flash('Saved'));
}

let flashTimer;
function flash(msg) {
  statusMsg.textContent = msg;
  statusMsg.classList.add('visible');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => statusMsg.classList.remove('visible'), 1400);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

enabledToggle.addEventListener('change', () => {
  const enabled = enabledToggle.checked;
  settingsEl.classList.toggle('disabled', !enabled);
  save('enabled', enabled);
});

delimiterRadios.forEach(r => {
  r.addEventListener('change', () => { if (r.checked) save('delimiterStyle', r.value); });
});

spacingRadios.forEach(r => {
  r.addEventListener('change', () => { if (r.checked) save('displaySpacing', r.value); });
});
