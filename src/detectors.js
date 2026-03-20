// detectors.js — LaTeX extraction functions for KaTeX, MathJax v3+, MathJax v2, and native MathML
// Each function is pure: given a DOM element, returns a LaTeX string or null.

// ---------------------------------------------------------------------------
// KaTeX
// ---------------------------------------------------------------------------

/**
 * Extract LaTeX source from a KaTeX-rendered element.
 * KaTeX stores the original TeX in an <annotation encoding="application/x-tex">
 * tag inside the hidden .katex-mathml subtree.
 *
 * @param {Element} element - Any element inside or including a .katex/.katex-display span
 * @returns {string|null}
 */
function extractKaTeXSource(element) {
  const katexEl =
    element.classList?.contains('katex-display') ? element :
    element.classList?.contains('katex') ? element :
    element.closest?.('.katex-display, .katex') ||
    element.querySelector?.('.katex-display, .katex');

  if (!katexEl) return null;

  const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]');
  return annotation ? annotation.textContent.trim() : null;
}

/**
 * Returns true if the KaTeX element is display-mode (block) math.
 *
 * @param {Element} katexEl - A .katex or .katex-display element
 * @returns {boolean}
 */
function isKaTeXDisplay(katexEl) {
  return katexEl.classList.contains('katex-display') || !!katexEl.closest('.katex-display');
}

// ---------------------------------------------------------------------------
// MathJax v3 / v4
// ---------------------------------------------------------------------------

/**
 * Extract LaTeX from a MathJax v3+ mjx-container element.
 * Tries (in order):
 *   1. <annotation encoding="application/x-tex"> in assistive MathML
 *   2. data-original / data-tex attributes on the container
 *   Returns null if neither is present (page-context API fallback handled in content.js).
 *
 * @param {Element} element - Any element inside or including an mjx-container
 * @returns {string|null}
 */
function extractMathJaxSource(element) {
  const container =
    element.tagName === 'MJX-CONTAINER' ? element :
    element.closest?.('mjx-container') ||
    element.querySelector?.('mjx-container');

  if (!container) return null;

  // Strategy 1: annotation tag in assistive MathML
  const annotation = container.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation) return annotation.textContent.trim();

  // Strategy 2: data attributes set by some sites
  if (container.dataset.original) return container.dataset.original;
  if (container.dataset.tex) return container.dataset.tex;

  return null; // Fallback to page-context API handled in content.js
}

/**
 * Returns true if the MathJax v3+ container is display-mode math.
 *
 * @param {Element} container - An mjx-container element
 * @returns {boolean}
 */
function isMathJaxDisplay(container) {
  return container.hasAttribute('display') && container.getAttribute('display') === 'true';
}

// ---------------------------------------------------------------------------
// MathJax v2 (legacy)
// ---------------------------------------------------------------------------

/**
 * Extract LaTeX from a MathJax v2 rendered element.
 * MathJax v2 keeps the original source in a sibling <script type="math/tex"> tag
 * whose id matches the rendered frame id minus the "-Frame" suffix.
 *
 * @param {Element} element - Any element inside or including a .MathJax span
 * @returns {string|null}
 */
function extractMathJaxV2Source(element) {
  const frame = element.classList?.contains('MathJax') ? element : element.closest?.('.MathJax');
  if (!frame) return null;

  const id = frame.id?.replace('-Frame', '');
  if (!id) return null;

  const script = document.getElementById(id);
  return script ? script.textContent.trim() : null;
}

/**
 * Returns true if the MathJax v2 element is display-mode math.
 *
 * @param {Element} element - A .MathJax element or ancestor
 * @returns {boolean}
 */
function isMathJaxV2Display(element) {
  return !!element.closest('.MathJax_Display');
}

// ---------------------------------------------------------------------------
// Native MathML (e.g. Wikipedia)
// ---------------------------------------------------------------------------

/**
 * Extract LaTeX from a native <math> element with an <annotation> child.
 * Wikipedia and some other sites embed the TeX source this way.
 *
 * @param {Element} element - Any element inside or including a <math> element
 * @returns {string|null}
 */
function extractNativeMathMLSource(element) {
  const mathEl = element.closest?.('math') || element.querySelector?.('math') ||
                 (element.tagName === 'MATH' ? element : null);
  if (!mathEl) return null;

  const annotation = mathEl.querySelector('annotation[encoding="application/x-tex"]');
  return annotation ? annotation.textContent.trim() : null;
}

/**
 * Returns true if the native <math> element is display-mode math.
 *
 * @param {Element} mathEl - A <math> element
 * @returns {boolean}
 */
function isNativeMathMLDisplay(mathEl) {
  const el = mathEl.tagName === 'MATH' ? mathEl : (mathEl.closest?.('math') || mathEl.querySelector?.('math'));
  return el?.getAttribute('display') === 'block';
}
