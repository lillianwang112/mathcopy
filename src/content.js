// content.js — Copy event interception.
// Depends on: detectors.js, serializer.js (loaded before this file via manifest).

'use strict';

// Cross-browser API shim (Chrome uses `chrome`, Firefox/Safari expose `browser`)
const api = typeof browser !== 'undefined' ? browser : chrome;

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const DEFAULT_PREFS = {
  enabled: true,
  delimiterStyle: 'dollar',   // 'dollar' | 'backslash'
  displaySpacing: 'newlines', // 'newlines' | 'spaces'
};

let prefs = { ...DEFAULT_PREFS };

// Load persisted preferences; fall back silently if storage is unavailable
try {
  api.storage.sync.get(['enabled', 'delimiterStyle', 'displaySpacing'], (stored) => {
    if (stored) {
      if (stored.enabled !== undefined) prefs.enabled = stored.enabled;
      if (stored.delimiterStyle) prefs.delimiterStyle = stored.delimiterStyle;
      if (stored.displaySpacing) prefs.displaySpacing = stored.displaySpacing;
    }
  });
} catch (_) {
  // Storage access failed — use defaults
}

// Re-read prefs when the popup changes them
try {
  api.storage.onChanged.addListener((changes) => {
    if (changes.enabled       !== undefined) prefs.enabled        = changes.enabled.newValue;
    if (changes.delimiterStyle !== undefined) prefs.delimiterStyle = changes.delimiterStyle.newValue;
    if (changes.displaySpacing !== undefined) prefs.displaySpacing = changes.displaySpacing.newValue;
  });
} catch (_) {}

// ---------------------------------------------------------------------------
// Quick bail check
// ---------------------------------------------------------------------------

/**
 * Fast check: does the current selection contain any math element?
 * Runs on every Ctrl+C; must be cheap.
 *
 * @param {Selection} selection
 * @returns {boolean}
 */
function selectionContainsMath(selection) {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const searchRoot =
    container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  if (!searchRoot) return false;

  return searchRoot.querySelector(
    '.katex, .katex-display, mjx-container, .MathJax, .MathJax_Display, math'
  ) !== null;
}

// ---------------------------------------------------------------------------
// MathJax page-context API injection (lazy, used as last-resort fallback)
// ---------------------------------------------------------------------------

let pageScriptInjected = false;

/**
 * Inject a tiny script into the page's execution context so we can reach
 * window.MathJax.startup.document (inaccessible from the isolated content
 * script world). Resolves with the LaTeX string or null.
 *
 * @param {Element} mjxContainer - The live mjx-container element in the page DOM
 * @returns {Promise<string|null>}
 */
function requestMathJaxSourceFromPage(mjxContainer) {
  return new Promise((resolve) => {
    const requestId = 'mathcopy-' + Math.random().toString(36).slice(2);

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 500);

    function handler(event) {
      if (event.data?.type === 'mathcopy-response' && event.data.requestId === requestId) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(event.data.latex || null);
      }
    }
    window.addEventListener('message', handler);

    mjxContainer.dataset.mathcopyRequest = requestId;

    if (!pageScriptInjected) {
      pageScriptInjected = true;
      const script = document.createElement('script');
      script.id = 'mathcopy-page-script';
      script.textContent = `
        window.addEventListener('message', (event) => {
          if (event.data?.type !== 'mathcopy-request') return;
          const requestId = event.data.requestId;
          const el = document.querySelector('[data-mathcopy-request="' + requestId + '"]');
          if (!el || !window.MathJax?.startup?.document) {
            window.postMessage({ type: 'mathcopy-response', requestId, latex: null });
            return;
          }
          let latex = null;
          for (const item of window.MathJax.startup.document.math) {
            if (item.typesetRoot === el) {
              latex = item.math;
              break;
            }
          }
          el.removeAttribute('data-mathcopy-request');
          window.postMessage({ type: 'mathcopy-response', requestId, latex });
        });
      `;
      document.documentElement.appendChild(script);
      // The script element itself is not needed after execution
      script.remove();
    }

    window.postMessage({ type: 'mathcopy-request', requestId });
  });
}

/**
 * Walk the live selection range and build a map of { mathcopy-id → latex }
 * for any mjx-container elements that need the page-context API fallback.
 * Tags containers with data-mathcopy-id, to be read from the cloned fragment.
 *
 * @param {Selection} selection
 * @returns {Promise<Map<string, string>>}
 */
async function buildMjxLatexMap(selection) {
  const map = new Map();
  if (!selection.rangeCount) return map;

  const range = selection.getRangeAt(0);
  const searchRoot =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!searchRoot) return map;

  const containers = [...searchRoot.querySelectorAll('mjx-container')];
  const pending = [];

  for (const c of containers) {
    // Only fall back to the page API if the DOM methods found nothing
    if (!extractMathJaxSource(c)) {
      const id = 'mj-' + Math.random().toString(36).slice(2);
      c.dataset.mathcopyId = id;
      pending.push({ id, container: c });
    }
  }

  if (pending.length > 0) {
    await Promise.all(
      pending.map(async ({ id, container }) => {
        const latex = await requestMathJaxSourceFromPage(container);
        if (latex) map.set(id, latex);
        // Clean up the temporary attribute
        delete container.dataset.mathcopyId;
      })
    );
  }

  return map;
}

// ---------------------------------------------------------------------------
// Copy event handler
// ---------------------------------------------------------------------------

document.addEventListener('copy', async (event) => {
  // Respect user's enabled toggle
  if (!prefs.enabled) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  // Fast bail: no math in selection
  if (!selectionContainsMath(selection)) return;

  // Build MathJax API fallback map (async, only when mjx-containers are present)
  const range = selection.getRangeAt(0);
  const hasMjx = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement
  )?.querySelector('mjx-container') !== null;

  const mjxLatexMap = hasMjx ? await buildMjxLatexMap(selection) : new Map();

  const serialized = serializeSelection(selection, prefs, mjxLatexMap);
  if (!serialized) return; // Nothing to override — let native copy proceed

  event.preventDefault();
  event.clipboardData.setData('text/plain', serialized);

  // Also set text/html so rich-paste targets get the original rendered HTML
  const div = document.createElement('div');
  div.appendChild(selection.getRangeAt(0).cloneContents());
  event.clipboardData.setData('text/html', div.innerHTML);

  // Notify background service worker to flash the badge
  try { api.runtime.sendMessage({ type: 'mathcopy-copied' }); } catch (_) {}
}, true /* capture phase — run before site's own copy handlers */);
