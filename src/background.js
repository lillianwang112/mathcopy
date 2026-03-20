// background.js — MV3 service worker.
// Handles: default pref seeding on install, badge feedback when math is copied.

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ---------------------------------------------------------------------------
// On install: seed default preferences and configure the badge
// ---------------------------------------------------------------------------

api.runtime.onInstalled.addListener(() => {
  // Write defaults only for keys not yet stored
  api.storage.sync.get(['enabled', 'delimiterStyle', 'displaySpacing'], (stored) => {
    const defaults = {};
    if (stored.enabled        === undefined) defaults.enabled        = true;
    if (!stored.delimiterStyle)              defaults.delimiterStyle  = 'dollar';
    if (!stored.displaySpacing)             defaults.displaySpacing  = 'newlines';
    if (Object.keys(defaults).length > 0) {
      api.storage.sync.set(defaults);
    }
  });

  api.action.setBadgeBackgroundColor({ color: '#b91c1c' });
  api.action.setBadgeText({ text: '' });
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'mathcopy-copied') {
    // Flash a checkmark badge on the toolbar icon for the active tab
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      api.action.setBadgeText({ text: '✓', tabId });
      setTimeout(() => api.action.setBadgeText({ text: '', tabId }), 1500);
    }
  }
  // Return false — no async sendResponse needed
  return false;
});
