# MathCopy — Technical Specification

**Copy rendered math as LaTeX source from any webpage.**

> A cross-browser extension that intercepts copy events on pages containing KaTeX or MathJax
> rendered math, replacing the visual gibberish in the clipboard with clean LaTeX wrapped in
> `$...$` (inline) or `$$...$$` (display), while preserving all surrounding plain text verbatim.

---

## 1. Name

**MathCopy** is clean and descriptive. Alternatives considered: LaTeXLift, CopyTeX, MathGrab.
Recommendation: stick with **MathCopy** — it's googleable, unambiguous, and available as a
Chrome Web Store name (as of this writing).

---

## 2. Manifest V3 Structure

### 2.1 Why Manifest V3

Chrome requires MV3 for all new extensions. Firefox supports MV3 as of Firefox 109+. Edge uses
Chromium's MV3 natively. Safari supports MV3 via `safari-web-extension-converter`. One manifest
format covers all four browsers.

### 2.2 Files and Their Roles

```
mathcopy/
├── manifest.json          # Extension metadata, permissions, content script registration
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── content.js         # Main content script — copy interception + DOM serialization
│   ├── detectors.js       # KaTeX/MathJax detection and LaTeX extraction logic
│   ├── serializer.js      # Selection → ordered text+math serialization
│   ├── background.js      # Service worker (MV3) — badge updates, optional analytics
│   └── popup/
│       ├── popup.html      # Toggle on/off, delimiter preference UI
│       ├── popup.js        # Reads/writes extension storage for user preferences
│       └── popup.css
├── tests/
│   ├── test-katex.html     # Local test page with KaTeX-rendered math
│   ├── test-mathjax.html   # Local test page with MathJax-rendered math
│   └── test-mixed.html     # Page with both libraries + plain text interleaving
└── README.md
```

### 2.3 manifest.json

```json
{
  "manifest_version": 3,
  "name": "MathCopy",
  "version": "1.0.0",
  "description": "Copy rendered math as clean LaTeX. Works on any site using KaTeX or MathJax.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": [
    "clipboardWrite",
    "storage"
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    }
  },
  "background": {
    "service_worker": "src/background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "src/detectors.js",
        "src/serializer.js",
        "src/content.js"
      ],
      "run_at": "document_idle"
    }
  ]
}
```

### 2.4 Why `<all_urls>` Is Safe Here

The content script does **nothing** until a `copy` event fires AND the selection contains a
recognized math element. On pages with no KaTeX/MathJax, the event listener runs a single
`querySelector` check and bails — negligible overhead. This is strictly better than maintaining a
hardcoded list of domains, because KaTeX/MathJax appear on thousands of sites (lecture notes,
blogs, Stack Exchange, Notion, Obsidian Publish, etc.). The extension requests no network
permissions, injects no UI, and modifies no page content — it only acts on the clipboard at the
moment of copy.

---

## 3. Detecting KaTeX vs MathJax in the DOM

### 3.1 KaTeX DOM Structure

KaTeX renders each math expression into a `<span class="katex">` containing two children:

```
<span class="katex">                         ← or <span class="katex-display"> for block
  <span class="katex-mathml">               ← Hidden MathML (contains LaTeX source)
    <math xmlns="...">
      <semantics>
        <mrow>...</mrow>
        <annotation encoding="application/x-tex">
          \frac{a}{b}                        ← THE LATEX SOURCE
        </annotation>
      </semantics>
    </math>
  </span>
  <span class="katex-html" aria-hidden="true">  ← Visual rendering (ignore this)
    ...deeply nested spans...
  </span>
</span>
```

**LaTeX extraction for KaTeX:**
```javascript
function extractKaTeXSource(element) {
  // element is a .katex or .katex-display span, or any ancestor thereof
  const katexEl = element.closest('.katex, .katex-display')
                  || element.querySelector('.katex, .katex-display');
  if (!katexEl) return null;

  const annotation = katexEl.querySelector(
    'annotation[encoding="application/x-tex"]'
  );
  return annotation ? annotation.textContent.trim() : null;
}
```

**Display vs inline detection for KaTeX:**
- `<span class="katex-display">` → display math → wrap in `$$...$$`
- `<span class="katex">` (without `-display`) → inline math → wrap in `$...$`
- Also check the parent: if the `.katex` span lives inside a `.katex-display` wrapper, it's display mode.

```javascript
function isKaTeXDisplay(katexEl) {
  return katexEl.classList.contains('katex-display')
      || !!katexEl.closest('.katex-display');
}
```

### 3.2 MathJax DOM Structure

MathJax v3/v4 renders into `<mjx-container>` custom elements. The structure varies by output
format (CHTML vs SVG), but the extraction strategy is the same.

**Primary source: assistive MathML (enabled by default in MathJax ≥ 3.0.5)**

```
<mjx-container class="MathJax" jax="CHTML" display="true">
  <mjx-math class="MJX-TEX" aria-hidden="true">
    ...visual rendering (custom elements like mjx-mi, mjx-mo, etc.)...
  </mjx-math>
  <mjx-assistive-mml unselectable="on" display="block">
    <math xmlns="..." display="block">
      <semantics>
        <mrow>...</mrow>
        <annotation encoding="application/x-tex">   ← SOMETIMES PRESENT
          \frac{a}{b}
        </annotation>
      </semantics>
    </math>
  </mjx-assistive-mml>
</mjx-container>
```

**Important:** The `<annotation encoding="application/x-tex">` tag inside MathJax's assistive
MathML is **not present by default**. It only appears if the site's MathJax config sets
`semantics: true` in `menuOptions.settings`. Most sites do NOT set this.

**Fallback sources for MathJax (in priority order):**

1. `<annotation encoding="application/x-tex">` inside `<mjx-assistive-mml>` — ideal, but rare
2. `MathJax.startup.document.getMathItemsWithin(container)` — access the internal MathItem
   objects which store the original TeX in `.math` property. This requires the page's MathJax
   global to be accessible.
3. `mjx-container` may have a `data-original` or `data-tex` attribute if the site has configured
   MathJax to store it (non-default; some sites add this via post-filters).
4. MathJax v2 fallback: look for `<script type="math/tex">` or `<script type="math/tex; mode=display">`
   elements adjacent to the rendered output.

**Extraction strategy for MathJax:**

```javascript
function extractMathJaxSource(element) {
  const container = element.closest('mjx-container')
                    || element.querySelector('mjx-container');
  if (!container) return null;

  // Strategy 1: annotation tag in assistive MathML
  const annotation = container.querySelector(
    'annotation[encoding="application/x-tex"]'
  );
  if (annotation) return annotation.textContent.trim();

  // Strategy 2: data attributes (some sites add these)
  if (container.dataset.original) return container.dataset.original;
  if (container.dataset.tex) return container.dataset.tex;

  // Strategy 3: MathJax internal API (page's global MathJax object)
  // Must use page-context injection (see Section 3.4)
  // This is the most reliable method for MathJax v3+
  return null; // Will be handled by page-context script
}
```

**Display vs inline detection for MathJax:**
```javascript
function isMathJaxDisplay(container) {
  return container.hasAttribute('display')
      && container.getAttribute('display') === 'true';
  // MathJax sets display="true" on the mjx-container for display math
}
```

### 3.3 MathJax v2 Legacy

Some older sites still use MathJax v2. Its structure is different:

```
<span class="MathJax" id="MathJax-Element-1-Frame">
  ...rendered spans...
</span>
<script type="math/tex" id="MathJax-Element-1">  ← Contains LaTeX source
  \frac{a}{b}
</script>
```

Or for display:
```
<div class="MathJax_Display">
  <span class="MathJax" id="MathJax-Element-2-Frame">...</span>
</div>
<script type="math/tex; mode=display" id="MathJax-Element-2">
  \frac{a}{b}
</script>
```

**Extraction:**
```javascript
function extractMathJaxV2Source(element) {
  const frame = element.closest('.MathJax');
  if (!frame) return null;
  const id = frame.id?.replace('-Frame', '');
  if (!id) return null;
  const script = document.getElementById(id);
  return script ? script.textContent.trim() : null;
}

function isMathJaxV2Display(element) {
  return !!element.closest('.MathJax_Display')
      || element.querySelector('script[type="math/tex; mode=display"]') !== null;
}
```

### 3.4 Accessing MathJax Internal API from a Content Script

Content scripts run in an isolated world and cannot access the page's `window.MathJax` directly.
To access MathJax's internal MathItem objects (the most reliable source for original TeX in
MathJax v3+), inject a page-context script:

```javascript
// In content.js — inject a script that runs in the PAGE's context
function requestMathJaxSource(mjxContainerElement) {
  return new Promise((resolve) => {
    const requestId = 'mathcopy-' + Math.random().toString(36).slice(2);

    // Listen for the response
    window.addEventListener('message', function handler(event) {
      if (event.data?.type === 'mathcopy-response' && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        resolve(event.data.latex);
      }
    });

    // Tag the element so the page script can find it
    mjxContainerElement.dataset.mathcopyRequest = requestId;

    // Inject page-context script (only once)
    if (!document.getElementById('mathcopy-page-script')) {
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
    }

    window.postMessage({ type: 'mathcopy-request', requestId });
  });
}
```

**Note:** This page-context injection approach should be used ONLY as a fallback when the
annotation tag and data-attribute methods fail. It adds complexity and a small security surface.

---

## 4. Serializing the DOM Selection in Order

This is the hardest part of the extension. The user selects a range of text that may interleave
plain text nodes, math elements, headings, code blocks, and other HTML. We must walk the
selection in document order, correctly identify each node as "plain text" or "math," and
produce a single string.

### 4.1 Core Algorithm

```javascript
function serializeSelection(selection) {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();

  // Walk the fragment's DOM tree in order
  const parts = [];
  walkNode(fragment, parts);

  const result = parts.join('');

  // Only return our custom serialization if we actually found math
  // Otherwise, return null to let native copy behavior proceed
  return parts.some(p => p.startsWith('$')) ? result : null;
}

function walkNode(node, parts) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  // Check if this element IS a math element (or contains one as its root)
  const mathResult = tryExtractMath(node);
  if (mathResult) {
    parts.push(mathResult);
    return; // Don't recurse into math elements
  }

  // Handle block-level elements: add newlines
  const display = getComputedStyle(node).display;
  const isBlock = display === 'block' || display === 'flex'
               || display === 'grid' || display === 'list-item'
               || node.tagName === 'BR';

  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
    parts.push('\n');
  }

  // Recurse into children
  for (const child of node.childNodes) {
    walkNode(child, parts);
  }

  if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
    parts.push('\n');
  }
}

function tryExtractMath(node) {
  // Check KaTeX
  const katexEl = node.classList?.contains('katex') ? node
                : node.classList?.contains('katex-display') ? node
                : node.closest?.('.katex, .katex-display')
                || node.querySelector?.('.katex, .katex-display');

  if (katexEl) {
    const latex = extractKaTeXSource(katexEl);
    if (latex) {
      const display = isKaTeXDisplay(katexEl);
      return display ? `$$${latex}$$` : `$${latex}$`;
    }
  }

  // Check MathJax v3+
  const mjxEl = node.tagName === 'MJX-CONTAINER' ? node
              : node.closest?.('mjx-container')
              || node.querySelector?.('mjx-container');

  if (mjxEl) {
    const latex = extractMathJaxSource(mjxEl);
    if (latex) {
      const display = isMathJaxDisplay(mjxEl);
      return display ? `$$${latex}$$` : `$${latex}$`;
    }
  }

  // Check MathJax v2
  const mjv2 = node.classList?.contains('MathJax') ? node
             : node.closest?.('.MathJax')
             || node.querySelector?.('.MathJax');

  if (mjv2) {
    const latex = extractMathJaxV2Source(mjv2);
    if (latex) {
      const display = isMathJaxV2Display(mjv2);
      return display ? `$$${latex}$$` : `$${latex}$`;
    }
  }

  return null;
}
```

### 4.2 Why cloneContents() Instead of Walking the Live DOM

`range.cloneContents()` gives us a DocumentFragment containing exactly the selected nodes,
already trimmed to the selection boundaries. Walking the live DOM with `range.startContainer` /
`range.endContainer` is error-prone because:

- The range may start mid-text-node (need to split)
- Ancestor elements that are only partially selected need careful boundary handling
- With `cloneContents()`, the browser handles all this trimming for us

**Critical limitation:** `cloneContents()` produces a shallow clone — computed styles are lost,
and the clone is detached from the main document. The clone of a `<span class="katex">` still
has its class, so our detection works, but the `<annotation>` tag content will be present in the
clone since it's part of the DOM subtree.

However, for **MathJax**, the `<mjx-assistive-mml>` content IS cloned (it's in the DOM), but
accessing the page's `MathJax.startup.document` from a cloned fragment won't work. So for
MathJax API fallback, we must **also walk the live selection range** to identify which
`mjx-container` elements are selected, extract their LaTeX via the page-context API, and then
use the clone for ordering.

**Recommended hybrid approach:**

1. Before cloning, walk the live range to build a `Map<mjx-container, string>` of LaTeX for
   each MathJax container in the selection (using the page-context injection if needed).
2. Tag each `mjx-container` with a `data-mathcopy-id` attribute and a unique ID.
3. Clone the contents.
4. Walk the cloned fragment; when encountering an `mjx-container`, look up its LaTeX from the
   pre-built map using the `data-mathcopy-id`.
5. Clean up the `data-mathcopy-id` attributes from the live DOM.

---

## 5. Intercepting the Copy Event

### 5.1 Event Listener

```javascript
document.addEventListener('copy', (event) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return; // Nothing selected, native copy

  // Quick bail: does the selection contain any math?
  if (!selectionContainsMath(selection)) return; // Native copy proceeds

  const serialized = serializeSelection(selection);
  if (!serialized) return; // Fallback to native

  // Override clipboard
  event.preventDefault();
  event.clipboardData.setData('text/plain', serialized);

  // Preserve HTML clipboard for rich-paste scenarios
  // (pastes the original rendered HTML if pasting into a rich editor)
  const range = selection.getRangeAt(0);
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  event.clipboardData.setData('text/html', div.innerHTML);
}, true); // useCapture = true to run before other handlers
```

### 5.2 Quick Bail Check

The `selectionContainsMath()` check runs on every Ctrl+C. It must be fast:

```javascript
function selectionContainsMath(selection) {
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const searchRoot = container.nodeType === Node.ELEMENT_NODE
    ? container
    : container.parentElement;

  if (!searchRoot) return false;

  return searchRoot.querySelector(
    '.katex, .katex-display, mjx-container, .MathJax, .MathJax_Display'
  ) !== null;
}
```

This single `querySelector` call returns immediately on pages without math. On pages WITH math,
it confirms whether the selected region contains any — if not, native copy proceeds untouched.

### 5.3 Preserving Native Behavior

The extension **never** calls `event.preventDefault()` unless it has successfully produced a
serialized string AND that string contains at least one LaTeX delimiter. This means:

- Selecting only plain text on a math-enabled page → native copy
- Selecting inside a `<textarea>` or `<input>` → native copy (no `.katex` elements present)
- Selecting a code block that happens to contain `$...$` as literal text → native copy (no
  rendered math elements in DOM)
- Ctrl+A → Copy on a page with math → our handler runs, producing full-page text with LaTeX

---

## 6. Inline vs Display Math Handling

### 6.1 Rules

| Condition | Delimiter | Whitespace |
|-----------|-----------|------------|
| KaTeX: `.katex` (no `.katex-display` ancestor) | `$...$` | No extra whitespace |
| KaTeX: `.katex-display` or inside one | `$$...$$` | Newline before and after |
| MathJax: `mjx-container` without `display="true"` | `$...$` | No extra whitespace |
| MathJax: `mjx-container[display="true"]` | `$$...$$` | Newline before and after |
| MathJax v2: `.MathJax` not inside `.MathJax_Display` | `$...$` | No extra whitespace |
| MathJax v2: inside `.MathJax_Display` | `$$...$$` | Newline before and after |

### 6.2 Display Math Spacing

Display math gets its own paragraph:

```
...end of preceding text.

$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$

Start of following text...
```

Inline math flows within the sentence:

```
The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ where $a \neq 0$.
```

### 6.3 User Preference: Delimiter Style

Some users prefer `\(...\)` / `\[...\]` over `$...$` / `$$...$$`. The popup UI should offer
a toggle stored in `chrome.storage.sync`:

```javascript
// Delimiter options
const DELIMITERS = {
  dollar: { inline: ['$', '$'], display: ['$$', '$$'] },
  backslash: { inline: ['\\(', '\\)'], display: ['\\[', '\\]'] }
};
```

---

## 7. Edge Cases

### 7.1 Nested Math

KaTeX does not nest math within math — if a site somehow renders `$\text{where } $a > 0$$`,
the inner `$` is just text inside the outer KaTeX span. Our extraction pulls the full LaTeX
from the `<annotation>` tag, which contains everything including `\text{...}`. No special
handling needed.

### 7.2 Math Inside Code Blocks

If a `<code>` or `<pre>` element contains rendered math (rare but possible on some blogs),
we should still extract it. However, if the code block contains **literal** `$...$` as source
code text (not rendered), we must NOT treat it as math. The detection logic handles this
automatically: we look for `.katex` / `mjx-container` DOM elements, not `$` characters.

### 7.3 Math Inside Tables

Tables are common on math sites. The serializer must handle `<table>` → `<tr>` → `<td>`
structures by adding tab characters between cells and newlines between rows:

```javascript
// In walkNode():
if (node.tagName === 'TD' || node.tagName === 'TH') {
  if (node.previousElementSibling) parts.push('\t');
}
if (node.tagName === 'TR') {
  if (node.previousElementSibling) parts.push('\n');
}
```

### 7.4 Partial Selection of a Math Expression

If the user selects only part of a rendered equation (e.g., drags from the middle of a
fraction), the `cloneContents()` will contain a partial `.katex-html` subtree but the full
`.katex-mathml` subtree (because it's a single hidden block). The `<annotation>` tag will
still contain the complete LaTeX source. **This is desirable behavior** — partial math
selection produces the full expression. KaTeX's own copy-tex extension behaves the same way
and documents this as intentional.

For MathJax, partial selection of an `mjx-container` similarly yields the full expression
because we look up the source from the container element, not from the selected sub-elements.

### 7.5 Selections Starting or Ending Mid-Sentence

`cloneContents()` handles this natively — text nodes at the selection boundary are trimmed.
Example: selecting from "is equal to" through an equation to "for all" produces:

```
is equal to $x^2$ for all
```

The surrounding text fragments are preserved exactly as the browser trimmed them.

### 7.6 Multiple Math Expressions in One Selection

The tree walker handles this naturally. Each math element encountered during the walk gets
individually extracted and delimited. Example output:

```
Given $f(x) = x^2$ and $g(x) = \sin(x)$, the composite function is $f(g(x)) = \sin^2(x)$.
```

### 7.7 Sites That Strip MathML / Annotation Tags

Some sites (e.g., certain React-based renderers) strip the `<span class="katex-mathml">` from
KaTeX output or disable MathJax's assistive MML. When the annotation source is unavailable:

1. For MathJax: fall back to the page-context API (Section 3.4)
2. For KaTeX without annotation: **no reliable fallback exists** — the `.katex-html` visual
   tree is deeply nested spans with no semantic meaning. Log a warning to the console and
   fall back to native copy behavior for that expression.

### 7.8 Dynamic Content (Streaming LLM Responses)

On claude.ai and chatgpt.com, math is rendered dynamically as the response streams in.
Our content script attaches the `copy` listener at `document_idle`, and because we check the
selection at copy-time (not at page-load), we automatically handle dynamically rendered math.
No `MutationObserver` is needed.

---

## 8. Target Sites and Universal Content Script

### 8.1 Primary Targets

| Site | Math Library | LaTeX Source Location |
|------|-------------|----------------------|
| **claude.ai** | KaTeX | `<annotation encoding="application/x-tex">` inside `.katex-mathml` |
| **chatgpt.com** | KaTeX | Same as above (ChatGPT uses KaTeX for math rendering) |
| **Stack Exchange / Overflow** | MathJax v2 | `<script type="math/tex">` tags |
| **Wikipedia** | MathML (native) | `<annotation encoding="application/x-tex">` in `<math>` tags |
| **Notion** | KaTeX | Standard KaTeX DOM structure |
| **Overleaf preview** | MathJax v3 | assistive MathML or internal API |
| **GitHub (README rendering)** | KaTeX (via markdown) | Standard KaTeX DOM structure |
| **Any KaTeX site** | KaTeX | Universal detection via `.katex` class |
| **Any MathJax site** | MathJax v2/v3/v4 | Universal detection via `mjx-container` / `.MathJax` |

### 8.2 Wikipedia Special Case

Wikipedia uses native MathML, not KaTeX or MathJax. However, it embeds `<annotation>` tags
with the TeX source:

```html
<math xmlns="..." alttext="{\displaystyle E=mc^{2}}">
  <semantics>
    <mrow>...</mrow>
    <annotation encoding="application/x-tex">E=mc^{2}</annotation>
  </semantics>
</math>
```

Add a detector for native `<math>` elements with `<annotation encoding="application/x-tex">`:

```javascript
function extractNativeMathMLSource(element) {
  const mathEl = element.closest('math') || element.querySelector('math');
  if (!mathEl) return null;
  const annotation = mathEl.querySelector('annotation[encoding="application/x-tex"]');
  return annotation ? annotation.textContent.trim() : null;
}
```

Display detection: `<math display="block">` → `$$`, otherwise `$`.

### 8.3 Safety of Universal Content Script

Running on `<all_urls>` is safe because:

- **Zero DOM mutation:** We never modify the page's DOM (except briefly tagging `mjx-container`
  for MathJax API fallback, then cleaning up).
- **Zero network requests:** No data leaves the browser.
- **Lazy activation:** The copy handler checks `selectionContainsMath()` first — a single
  `querySelector` that short-circuits on non-math pages.
- **No visual injection:** No popups, banners, or style changes.
- **Capture-phase listener:** We use `useCapture: true` so we run before the site's own copy
  handlers, but we only `preventDefault()` when we have valid output.

---

## 9. Cross-Browser Compatibility

### 9.1 API Shim

At the top of `content.js` and `background.js`:

```javascript
const api = typeof browser !== 'undefined' ? browser : chrome;
```

This works because:
- **Chrome/Edge:** Only `chrome.*` is available
- **Firefox:** Both `browser.*` (with Promises) and `chrome.*` (with callbacks) are available;
  we prefer `browser.*`
- **Safari:** Supports `browser.*` namespace

### 9.2 Clipboard API Compatibility

`event.clipboardData.setData()` inside a `copy` event handler works identically across all
four browsers. This is standard Web API, not extension API. No compatibility issues.

### 9.3 MV3 Service Worker vs Background Page

Chrome MV3 requires a service worker. Firefox MV3 supports both service workers and event pages.
Safari supports service workers in MV3. Use `"service_worker"` in manifest for maximum
compatibility.

**Firefox consideration:** If supporting Firefox MV2 as well (for AMO distribution to older
Firefox), create a separate `manifest-firefox.json` with `"background": { "scripts": ["src/background.js"] }` and build both variants. For MV3-only, one manifest works.

### 9.4 Safari Conversion

Safari does not accept extensions directly — it requires wrapping in a native macOS/iOS app
via Apple's toolchain.

**Step-by-step:**

1. **Prerequisites:** macOS with Xcode 14+ installed. Apple Developer account ($99/year) for
   App Store distribution; free account works for local/unsigned testing.

2. **Convert:**
   ```bash
   xcrun safari-web-extension-converter /path/to/mathcopy/ \
     --bundle-identifier com.yourname.mathcopy \
     --project-location ./MathCopySafari \
     --force
   ```
   This generates an Xcode project containing a macOS app wrapper and the extension.

3. **What the converter produces:**
   - A macOS app (or iOS app) that serves solely as a host for the extension
   - An app extension target containing your JS/HTML/manifest
   - A `Info.plist` derived from your `manifest.json`
   - A Swift `AppDelegate` and `ViewController` with a "enable in Safari Preferences" message

4. **Build and run:**
   - Open the `.xcodeproj` in Xcode
   - Select a signing team (your Apple Developer account)
   - Build and run → the host app launches, telling you to enable the extension in Safari
   - Safari → Settings → Extensions → enable MathCopy

5. **Packaging overhead:**
   - The Xcode project is ~50MB on disk (mostly Xcode metadata), but the built `.app` is small
     (~2-5MB including your extension files)
   - For App Store distribution: archive → upload via Xcode or Transporter → App Store review
   - Review takes 24-48 hours typically
   - You must provide App Store screenshots and metadata just like a regular app

6. **What changes in the JS logic: almost nothing.**
   - Safari supports `browser.*` namespace natively — the API shim works as-is
   - `clipboardData.setData()` in copy handlers works identically
   - `<all_urls>` permission works but requires explicit user grant per-site in Safari 17+
     (Safari shows a per-site permission prompt; users can grant "always allow on all sites")
   - `document.execCommand('copy')` fallbacks (if needed) work in Safari
   - `MutationObserver`, `querySelector`, `cloneContents()` — all standard Web APIs, no issues
   - **One difference:** Safari's MV3 does NOT support `clipboardWrite` permission. Remove it
     from the Safari variant's manifest. In Safari, clipboard access inside a `copy` event
     handler doesn't require a permission — it's allowed by default because it's user-initiated.

7. **iOS/iPadOS:** The converter can also target iOS. Run the same command with `--ios-only` or
   build both. iPadOS Safari supports web extensions since iPadOS 15. The JS logic is identical.
   The host app needs an iOS target in Xcode (the converter sets this up).

### 9.5 Build Script for Multi-Browser Packaging

```bash
#!/bin/bash
# build.sh — Package for each browser's store

# Chrome / Edge (same zip)
zip -r mathcopy-chromium.zip manifest.json src/ icons/ -x "*.DS_Store"

# Firefox (may need separate manifest for MV2 compatibility)
# cp manifest-firefox.json manifest.json  # if maintaining MV2 variant
zip -r mathcopy-firefox.zip manifest.json src/ icons/ -x "*.DS_Store"

# Safari (requires macOS + Xcode)
xcrun safari-web-extension-converter ./mathcopy/ \
  --bundle-identifier com.yourname.mathcopy \
  --project-location ./build/safari \
  --force --no-open
cd build/safari
xcodebuild -scheme "MathCopy (macOS)" -configuration Release
```

---

## 10. User Preferences (Popup UI)

### 10.1 Settings

| Setting | Default | Options |
|---------|---------|---------|
| Extension enabled | `true` | Toggle on/off |
| Delimiter style | `dollar` | `dollar` (`$`/`$$`) or `backslash` (`\(\)`/`\[\]`) |
| Display math spacing | `newlines` | `newlines` (paragraph break) or `spaces` (inline) |
| Copy notification | `true` | Show brief "Copied as LaTeX" badge/toast |

### 10.2 Storage

```javascript
// Save preferences
api.storage.sync.set({ delimiterStyle: 'dollar', enabled: true });

// Read in content script
api.storage.sync.get(['delimiterStyle', 'enabled'], (prefs) => {
  // Use prefs.delimiterStyle, prefs.enabled
});
```

---

## 11. File Structure Summary (For Claude Code)

```
mathcopy/
│
├── manifest.json                   # MV3 manifest (see Section 2.3)
│
├── icons/
│   ├── icon16.png                  # Toolbar icon (16x16)
│   ├── icon48.png                  # Extension management page (48x48)
│   └── icon128.png                 # Chrome Web Store listing (128x128)
│
├── src/
│   ├── detectors.js                # ~120 lines
│   │   ├── extractKaTeXSource(element) → string|null
│   │   ├── isKaTeXDisplay(element) → boolean
│   │   ├── extractMathJaxSource(element) → string|null
│   │   ├── isMathJaxDisplay(element) → boolean
│   │   ├── extractMathJaxV2Source(element) → string|null
│   │   ├── isMathJaxV2Display(element) → boolean
│   │   ├── extractNativeMathMLSource(element) → string|null
│   │   └── isNativeMathMLDisplay(element) → boolean
│   │
│   ├── serializer.js               # ~100 lines
│   │   ├── serializeSelection(selection, prefs) → string|null
│   │   ├── walkNode(node, parts, prefs) → void
│   │   └── tryExtractMath(node, prefs) → string|null
│   │
│   ├── content.js                  # ~80 lines
│   │   ├── API shim
│   │   ├── Load preferences from storage
│   │   ├── selectionContainsMath(selection) → boolean
│   │   ├── copy event listener (capture phase)
│   │   └── MathJax page-context injection (lazy, on first need)
│   │
│   ├── background.js               # ~30 lines
│   │   └── Badge update on install, message handling for future features
│   │
│   └── popup/
│       ├── popup.html              # Simple toggle + delimiter selector
│       ├── popup.js                # Read/write storage, update UI
│       └── popup.css               # Minimal styling
│
├── tests/
│   ├── test-katex.html             # Include KaTeX CDN, render sample expressions
│   ├── test-mathjax.html           # Include MathJax CDN, render sample expressions
│   ├── test-mathjax-v2.html        # MathJax v2 for legacy testing
│   ├── test-mixed.html             # Both libraries on one page + prose + tables + code
│   └── test-native-mathml.html     # Wikipedia-style native MathML with annotations
│
├── build.sh                        # Multi-browser packaging script
└── README.md                       # User-facing documentation
```

---

## 12. Implementation Order (For Claude Code)

Execute in this order to stay unblocked at each step:

1. **`detectors.js`** — Pure functions, no DOM side effects. Write + unit test against static
   HTML strings using `DOMParser`.

2. **`serializer.js`** — Depends on detectors. Test by creating a DOM tree programmatically,
   making a Selection, and verifying output.

3. **`content.js`** — Wire detectors + serializer into the copy event. Test manually by
   loading `tests/test-katex.html` with the unpacked extension.

4. **`popup/`** — Preferences UI. Can be built in parallel.

5. **`background.js`** — Minimal service worker. Last priority.

6. **Test pages** — Create `tests/*.html` with CDN-loaded KaTeX/MathJax and a variety of
   expressions (inline, display, nested text, tables, code blocks).

7. **`build.sh`** — Once everything works in Chrome, package for Firefox and prep Safari.

---

## 13. Testing Checklist

### Critical paths to test manually:

- [ ] Select inline KaTeX expression → Ctrl+C → paste into plain text editor → verify `$...$`
- [ ] Select display KaTeX expression → verify `$$...$$` with surrounding newlines
- [ ] Select mixed text + multiple inline math → verify interleaving preserved
- [ ] Select only plain text on a KaTeX page → verify native copy behavior
- [ ] Select partial math expression → verify full LaTeX is copied
- [ ] Select across a paragraph boundary containing display math → verify paragraph structure
- [ ] Select inside a table cell containing math → verify clean output
- [ ] Test on chatgpt.com (KaTeX, dynamic content)
- [ ] Test on claude.ai (KaTeX, streaming responses)
- [ ] Test on math.stackexchange.com (MathJax v2)
- [ ] Test on a MathJax v3 site (e.g., mathjax.org documentation)
- [ ] Test on Wikipedia (native MathML)
- [ ] Test on a page with NO math → verify zero interference
- [ ] Test with extension disabled via popup → verify native copy
- [ ] Test delimiter preference switch (dollar ↔ backslash)
- [ ] Test in Firefox
- [ ] Test in Edge
- [ ] Test in Safari (after Xcode conversion)

---

## 14. Known Limitations

1. **MathJax v3+ without assistive MML and without page API access:** If a site disables
   assistive MathML AND runs MathJax in a way that blocks page-context injection (CSP), we
   cannot extract LaTeX. This is extremely rare.

2. **Server-side rendered KaTeX with stripped MathML:** If a site renders KaTeX on the server
   and strips the `<span class="katex-mathml">` from the output, we have no LaTeX source.
   No workaround exists short of reverse-engineering the visual rendering.

3. **Performance on massive pages:** A page with 10,000+ math expressions will still perform
   fine because we only process selected content at copy-time, not the entire page.

4. **Conflict with KaTeX copy-tex extension:** If a site loads KaTeX's own `copy-tex.js`
   extension, both handlers will fire. Because we use `useCapture: true`, our handler runs
   first. We call `preventDefault()`, which prevents copy-tex from also running. This is fine
   — our handler is strictly more capable (handles interleaved text, MathJax, etc.).

---

## 15. Future Enhancements

- **Right-click context menu:** "Copy as LaTeX" for individual equations without selecting
- **Configurable per-site enable/disable** via popup
- **Copy as other formats:** Typst (`$...$` with Typst syntax), Unicode math symbols, MathML
- **Paste-as-LaTeX:** Intercept paste events to convert LaTeX back to rendered math (much
  harder, out of scope for v1)
