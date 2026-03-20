// serializer.js — Walk a DOM selection and produce an ordered plain-text + LaTeX string.
// Depends on: detectors.js (must be loaded first).

/**
 * Serialize a Selection into a mixed plain-text / LaTeX string.
 * Returns null if the selection contains no math (caller should let native copy proceed).
 *
 * @param {Selection} selection - window.getSelection()
 * @param {Object} prefs - { delimiterStyle: 'dollar'|'backslash' }
 * @param {Map} [mjxLatexMap] - Pre-built map of mjx-container → LaTeX string for MathJax API fallback
 * @returns {string|null}
 */
function serializeSelection(selection, prefs, mjxLatexMap) {
  if (!selection || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();

  const parts = [];
  walkNode(fragment, parts, prefs, mjxLatexMap || new Map());

  const result = parts.join('');

  // Only hijack the clipboard when we actually produced LaTeX delimiters
  const hasLatex = parts.some(p => p.startsWith('$') || p.startsWith('\\(') || p.startsWith('\\['));
  return hasLatex ? result : null;
}

/**
 * Recursively walk a node (from a cloned DocumentFragment), accumulating parts.
 *
 * @param {Node} node
 * @param {string[]} parts
 * @param {Object} prefs
 * @param {Map} mjxLatexMap
 */
function walkNode(node, parts, prefs, mjxLatexMap) {
  // Text node — push verbatim
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  // Table structure: add separators before recursing into cells/rows
  if (node.tagName === 'TR' && node.previousElementSibling) {
    parts.push('\n');
  }
  if ((node.tagName === 'TD' || node.tagName === 'TH') && node.previousElementSibling) {
    parts.push('\t');
  }

  // Check if this element IS a math root (or contains one)
  const mathResult = tryExtractMath(node, prefs, mjxLatexMap);
  if (mathResult !== null) {
    parts.push(mathResult);
    return; // Don't recurse into math elements
  }

  // Determine block vs inline to insert newlines
  const isBlock = isBlockElement(node);

  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
    parts.push('\n');
  }

  for (const child of node.childNodes) {
    walkNode(child, parts, prefs, mjxLatexMap);
  }

  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
    parts.push('\n');
  }
}

/**
 * Attempt to identify a math element and return its delimited LaTeX string.
 * Returns null if the node is not a recognized math element.
 *
 * @param {Element} node
 * @param {Object} prefs
 * @param {Map} mjxLatexMap
 * @returns {string|null}
 */
function tryExtractMath(node, prefs, mjxLatexMap) {
  // --- KaTeX ---
  if (isKaTeXRoot(node)) {
    const latex = extractKaTeXSource(node);
    if (latex) {
      const display = isKaTeXDisplay(node);
      return formatLatex(latex, display, prefs);
    }
  }

  // --- MathJax v3+ ---
  if (isMjxRoot(node)) {
    // First check the pre-built map (for containers identified via page-context API)
    let latex = mjxLatexMap.get(node.dataset?.mathcopyId) || null;
    if (!latex) latex = extractMathJaxSource(node);
    if (latex) {
      const display = isMathJaxDisplay(node);
      return formatLatex(latex, display, prefs);
    }
  }

  // --- MathJax v2 ---
  if (isMjxV2Root(node)) {
    const latex = extractMathJaxV2Source(node);
    if (latex) {
      const display = isMathJaxV2Display(node);
      return formatLatex(latex, display, prefs);
    }
  }

  // --- Native MathML ---
  if (isNativeMathRoot(node)) {
    const latex = extractNativeMathMLSource(node);
    if (latex) {
      const display = isNativeMathMLDisplay(node);
      return formatLatex(latex, display, prefs);
    }
  }

  return null;
}

/**
 * Wrap a LaTeX string in the appropriate delimiters based on prefs and display mode.
 *
 * @param {string} latex
 * @param {boolean} display
 * @param {Object} prefs
 * @returns {string}
 */
function formatLatex(latex, display, prefs) {
  const style   = prefs?.delimiterStyle  || 'dollar';
  const spacing = prefs?.displaySpacing  || 'newlines';
  if (display) {
    const [open, close] = style === 'backslash' ? ['\\[', '\\]'] : ['$$', '$$'];
    return spacing === 'spaces' ? `${open}${latex}${close}` : `\n${open}${latex}${close}\n`;
  } else {
    const [open, close] = style === 'backslash' ? ['\\(', '\\)'] : ['$', '$'];
    return `${open}${latex}${close}`;
  }
}

// ---------------------------------------------------------------------------
// Element-type helpers
// ---------------------------------------------------------------------------

function isKaTeXRoot(node) {
  return node.classList?.contains('katex-display') ||
         node.classList?.contains('katex');
}

function isMjxRoot(node) {
  return node.tagName === 'MJX-CONTAINER';
}

function isMjxV2Root(node) {
  // Avoid double-matching: only treat as v2 root if not also a v3 container
  return node.classList?.contains('MathJax') && node.tagName !== 'MJX-CONTAINER';
}

function isNativeMathRoot(node) {
  return node.tagName === 'MATH';
}

function isBlockElement(node) {
  const tag = node.tagName;
  // Use a tag-based check since cloned nodes lack computed styles
  const blockTags = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'CAPTION',
    'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION',
    'BR',
  ]);
  return blockTags.has(tag);
}
