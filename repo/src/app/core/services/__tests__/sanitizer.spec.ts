import { describe, it, expect } from 'vitest';
import { sanitizePlainText, sanitizeHtml, countLinks, containsBlocklistedWords } from '../../utils/sanitizer';

/**
 * NOTE: sanitizer.ts uses DOMParser (browser API).
 * These tests run in jsdom which provides DOMParser — see vitest.config.ts.
 */

describe('sanitizePlainText', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizePlainText('')).toBe('');
  });

  it('strips script tags AND their inner code', () => {
    // The old regex approach removed the script element but leaked "alert()" as text.
    // The DOMParser approach removes REMOVED_TAGS entirely before extracting textContent.
    const result = sanitizePlainText('hello <script>alert("xss")</script> world');
    expect(result).toBe('hello  world');
    expect(result).not.toContain('alert');
  });

  it('strips all HTML tags and preserves text content', () => {
    expect(sanitizePlainText('<b>bold</b> text')).toBe('bold text');
  });

  it('strips nested tags and preserves inner text', () => {
    expect(sanitizePlainText('<div><p><strong>deep</strong></p></div>')).toBe('deep');
  });

  it('removes style tags and their content', () => {
    const result = sanitizePlainText('text <style>body{color:red}</style> after');
    expect(result).not.toContain('color');
    expect(result).toContain('text');
    expect(result).toContain('after');
  });

  it('removes iframe tags entirely', () => {
    const result = sanitizePlainText('<iframe src="evil.com">fallback</iframe>visible');
    expect(result).not.toContain('evil.com');
    // iframe is a REMOVED_TAG so its content "fallback" is also stripped
    expect(result).toBe('visible');
  });

  it('preserves plain text with angle-bracket-like sequences as-is', () => {
    // After DOMParser and textContent extraction, literal characters are returned —
    // no HTML-entity encoding. Angular template interpolation handles display escaping.
    const result = sanitizePlainText('a < b');
    expect(result).toContain('a');
    expect(result).toContain('b');
  });
});

describe('sanitizeHtml', () => {
  it('strips script tags and their code, keeps surrounding text', () => {
    const result = sanitizeHtml('hello <script>bad()</script> world');
    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).not.toContain('bad()');
    expect(result).not.toContain('script');
  });

  it('strips script tags but preserves allowed sibling elements', () => {
    const result = sanitizeHtml('hello <script>bad</script> <b>world</b>');
    expect(result).toContain('<b>world</b>');
    expect(result).not.toContain('bad');
  });

  it('removes on* event handler attributes', () => {
    const result = sanitizeHtml('<div onmouseover="alert(1)">test</div>');
    expect(result).toContain('test');
    expect(result).not.toContain('onmouseover');
    expect(result).not.toContain('alert');
  });

  it('removes onclick from an allowed element', () => {
    const result = sanitizeHtml('<b onclick="steal()">label</b>');
    expect(result).toContain('label');
    expect(result).not.toContain('onclick');
  });

  it('removes javascript: href from anchor tags', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
  });

  it('removes data: href from anchor tags', () => {
    const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(result).not.toContain('data:');
  });

  it('strips disallowed tags (e.g. <marquee>) but preserves their text', () => {
    const result = sanitizeHtml('<marquee>scrolling text</marquee>');
    expect(result).toContain('scrolling text');
    expect(result).not.toContain('marquee');
  });

  it('preserves allowed formatting tags', () => {
    const result = sanitizeHtml('<strong>bold</strong> and <em>italic</em>');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('preserves allowed structure (ul/ol/li)', () => {
    const result = sanitizeHtml('<ul><li>item 1</li><li>item 2</li></ul>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item 1</li>');
  });

  it('allows safe https links and adds rel/target', () => {
    const result = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it('strips class attributes from disallowed elements after unwrapping', () => {
    // <span class="x"> is allowed; <custom class="x"> is not — it gets unwrapped
    const result = sanitizeHtml('<custom class="x">text</custom>');
    expect(result).not.toContain('custom');
    expect(result).toContain('text');
  });

  it('strips style tags entirely (content not visible)', () => {
    const result = sanitizeHtml('before<style>body { display:none }</style>after');
    expect(result).not.toContain('display');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });
});

describe('countLinks', () => {
  it('returns 0 for text with no links', () => {
    expect(countLinks('hello world')).toBe(0);
  });

  it('counts http links', () => {
    expect(countLinks('visit http://example.com today')).toBe(1);
  });

  it('counts https links', () => {
    expect(countLinks('see https://secure.com for more')).toBe(1);
  });

  it('counts multiple distinct links', () => {
    expect(countLinks('http://a.com http://b.com https://c.com')).toBe(3);
  });

  it('does not count partial URL patterns without a scheme', () => {
    expect(countLinks('go to example.com for info')).toBe(0);
  });
});

describe('containsBlocklistedWords', () => {
  it('returns empty array for clean text', () => {
    expect(containsBlocklistedWords('hello world', ['bad', 'evil'])).toEqual([]);
  });

  it('detects exact blocklisted words case-insensitively', () => {
    expect(containsBlocklistedWords('This is BAD content', ['bad'])).toEqual(['bad']);
  });

  it('detects multiple violations', () => {
    const result = containsBlocklistedWords('bad and evil stuff', ['bad', 'evil', 'good']);
    expect(result).toContain('bad');
    expect(result).toContain('evil');
    expect(result).not.toContain('good');
  });

  it('detects substring matches', () => {
    // "badminton" contains "bad" — intentional substring detection
    expect(containsBlocklistedWords('I play badminton', ['bad'])).toContain('bad');
  });
});
