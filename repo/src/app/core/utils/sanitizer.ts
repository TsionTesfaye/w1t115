/**
 * HTML sanitization utilities.
 *
 * Uses DOMParser to parse input into a real DOM tree, then walks the tree
 * applying a strict allowlist of tags and attributes.  Regex-based stripping
 * is fundamentally bypassable (case variants, encoded characters, malformed
 * tags) — the parser-then-allowlist approach is not.
 *
 * Neither function executes scripts: DOMParser is sandboxed and the sanitized
 * fragment is never inserted into the live document.
 */

// ── Block-lists (element + content fully removed) ─────────────────────────

/**
 * These elements are removed entirely — their inner content is NOT preserved.
 * This is different from disallowed-but-not-blocked tags (which are unwrapped).
 */
const REMOVED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed',
  'form', 'input', 'button', 'select', 'textarea',
  'link', 'meta', 'noscript', 'base',
]);

// ── Allow-lists ────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'a',
  'blockquote', 'code', 'pre',
  'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/** Per-tag allowed attribute names. '*' applies to every allowed tag. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  'a':    new Set(['href', 'title', 'rel']),
  'td':   new Set(['colspan', 'rowspan']),
  'th':   new Set(['colspan', 'rowspan', 'scope']),
  '*':    new Set(['class']),
};

/** href/src values must start with one of these protocols (or be relative). */
const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Sanitize a rich-text HTML string.
 * Allowed: the tags and attributes listed above.
 * Disallowed tags are *unwrapped* (their text content is preserved).
 * href values that don't begin with a safe protocol are removed.
 * All event-handler attributes (on*) and javascript: / data: URLs are rejected.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  const doc = new DOMParser().parseFromString(input, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

/**
 * Strip ALL HTML and return plain text.
 * Uses the parser to handle edge-cases like `<` without a matching `>` or
 * partial tags that regex-based strippers can miss.
 *
 * REMOVED_TAGS are excised before extracting textContent so that script/style
 * source code does not bleed into the output as visible text.
 */
export function sanitizePlainText(input: string): string {
  if (!input) return '';
  const doc = new DOMParser().parseFromString(input, 'text/html');
  stripRemovedTags(doc.body);
  return (doc.body.textContent ?? '').trim();
}

/** Remove REMOVED_TAGS (and their entire subtrees) from a DOM element in-place. */
function stripRemovedTags(node: Element): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (REMOVED_TAGS.has(el.tagName.toLowerCase())) {
        node.removeChild(el);
      } else {
        stripRemovedTags(el);
      }
    }
  }
}

export function countLinks(text: string): number {
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  const matches = text.match(urlPattern);
  return matches ? matches.length : 0;
}

export function containsBlocklistedWords(text: string, blocklist: string[]): string[] {
  const lower = text.toLowerCase();
  return blocklist.filter(word => lower.includes(word.toLowerCase()));
}

// ── DOM walk ───────────────────────────────────────────────────────────────

function sanitizeNode(node: Element): void {
  // Snapshot childNodes before we mutate them
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE ||
        child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      // Comments and processing instructions are stripped unconditionally
      node.removeChild(child);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Text nodes are safe as-is
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (REMOVED_TAGS.has(tag)) {
      // Blocked element: remove entirely (content not preserved)
      node.removeChild(el);
    } else if (!ALLOWED_TAGS.has(tag)) {
      // Disallowed but not blocked: unwrap (keep text content, discard the element)
      sanitizeNode(el);
      const parent = el.parentNode!;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    } else {
      sanitizeAttributes(el, tag);
      sanitizeNode(el);
    }
  }
}

function sanitizeAttributes(el: Element, tag: string): void {
  const tagAllowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const globalAllowed = ALLOWED_ATTRS['*'];

  // Snapshot attributes before mutation
  const attrs = Array.from(el.attributes);

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();

    // Block all event handlers regardless of allow-list
    if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }

    if (!tagAllowed.has(name) && !globalAllowed.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }

    // Validate URL-bearing attributes
    if (name === 'href' || name === 'src' || name === 'action') {
      const value = attr.value.trim();
      if (!SAFE_URL.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  // Force safe link behaviour — prevents opener hijacking
  if (tag === 'a' && el.hasAttribute('href')) {
    el.setAttribute('rel', 'noopener noreferrer');
    el.setAttribute('target', '_blank');
  }
}
