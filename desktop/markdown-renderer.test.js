const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, escapeHtml, safeUrl } = require('./markdown-renderer');

// ── XSS via raw HTML ────────────────────────────────────────────────

test('renderMarkdown escapes raw <script> tags in body', () => {
  const out = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'),
    'raw <script> survived: ' + out);
  assert.ok(out.includes('&lt;script&gt;'),
    'expected escaped script tag: ' + out);
});

test('renderMarkdown escapes <img onerror> inside emphasis', () => {
  const out = renderMarkdown('**foo<img src=x onerror=alert(1)>bar**');
  assert.ok(!/<img\s/i.test(out), 'raw <img> survived: ' + out);
  assert.ok(out.includes('<strong>'), 'emphasis still rendered: ' + out);
});

test('renderMarkdown escapes raw HTML inside heading', () => {
  const out = renderMarkdown('# Hello <img src=x onerror=alert(1)>');
  assert.ok(out.startsWith('<p><h1>Hello &lt;img'),
    'heading content not escaped: ' + out);
});

test('renderMarkdown escapes raw HTML inside list item', () => {
  const out = renderMarkdown('- <iframe src=javascript:alert(1)></iframe>');
  assert.ok(!/<iframe/i.test(out), 'raw <iframe> survived: ' + out);
});

test('renderMarkdown escapes raw HTML inside blockquote', () => {
  const out = renderMarkdown('> <script>alert(1)</script>');
  assert.ok(!/<script>/i.test(out), 'raw <script> survived: ' + out);
});

test('renderMarkdown escapes raw HTML inside table cell', () => {
  const out = renderMarkdown('| a | b |\n|---|---|\n| <script>x</script> | y |');
  assert.ok(!/<script>/i.test(out), 'raw <script> survived in table: ' + out);
});

// ── URL scheme allow-list ────────────────────────────────────────────

test('renderMarkdown blocks javascript: link', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  assert.ok(!/href="javascript/i.test(out),
    'javascript: URL ended up in href: ' + out);
});

test('renderMarkdown blocks data: image', () => {
  const out = renderMarkdown('![x](data:text/html,<script>alert(1)</script>)');
  assert.ok(!/src="data:/i.test(out),
    'data: URL ended up in src: ' + out);
});

test('renderMarkdown blocks vbscript: link', () => {
  const out = renderMarkdown('[x](vbscript:msgbox)');
  assert.ok(!/href="vbscript/i.test(out));
});

test('renderMarkdown blocks file: link', () => {
  const out = renderMarkdown('[x](file:///etc/passwd)');
  assert.ok(!/href="file:/i.test(out));
});

test('renderMarkdown allows http(s) links + rel=noopener', () => {
  const out = renderMarkdown('[x](https://example.com)');
  assert.ok(/href="https:\/\/example.com" rel="noopener noreferrer"/.test(out),
    'expected safe https link: ' + out);
});

test('renderMarkdown allows relative + root-relative + fragment URLs', () => {
  assert.ok(renderMarkdown('[a](./x.png)').includes('href="./x.png"'));
  assert.ok(renderMarkdown('[a](/foo)').includes('href="/foo"'));
  assert.ok(renderMarkdown('[a](#h)').includes('href="#h"'));
  assert.ok(renderMarkdown('[a](image.png)').includes('href="image.png"'));
});

// ── safeUrl unit ─────────────────────────────────────────────────────

test('safeUrl rejects script-y schemes', () => {
  assert.equal(safeUrl('javascript:alert(1)'), false);
  assert.equal(safeUrl('JavaScript:alert(1)'), false);
  assert.equal(safeUrl('data:text/html,<x>'), false);
  assert.equal(safeUrl('vbscript:msgbox'), false);
  assert.equal(safeUrl('file:///etc/passwd'), false);
  // Tab/newline obfuscation
  assert.equal(safeUrl('java\tscript:alert(1)'), false);
});

test('safeUrl accepts http(s) and relative URLs', () => {
  assert.equal(safeUrl('https://example.com'), true);
  assert.equal(safeUrl('http://example.com/?a=1'), true);
  assert.equal(safeUrl('/path/to/x'), true);
  assert.equal(safeUrl('./foo'), true);
  assert.equal(safeUrl('../foo'), true);
  assert.equal(safeUrl('#section'), true);
  assert.equal(safeUrl('image.png'), true);
});

test('safeUrl rejects empty/non-string', () => {
  assert.equal(safeUrl(''), false);
  assert.equal(safeUrl('   '), false);
  assert.equal(safeUrl(null), false);
  assert.equal(safeUrl(undefined), false);
  assert.equal(safeUrl(123), false);
});

// ── Regression: normal markdown still renders ────────────────────────

test('renderMarkdown still renders standard markdown', () => {
  const out = renderMarkdown('# Hello\n\nSome **bold** and *italic* and `code`.');
  assert.ok(out.includes('<h1>Hello</h1>'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<em>italic</em>'));
  assert.ok(out.includes('<code>code</code>'));
});

test('renderMarkdown renders fenced code with escaped content', () => {
  const out = renderMarkdown('```js\nconst x = "<div>";\n```');
  assert.ok(out.includes('<pre><code>'));
  assert.ok(out.includes('&lt;div&gt;'),
    'angle brackets inside code should be escaped: ' + out);
});

test('renderMarkdown renders blockquote', () => {
  const out = renderMarkdown('> hello world');
  assert.ok(out.includes('<blockquote>hello world</blockquote>'),
    'blockquote not rendered: ' + out);
});

test('renderMarkdown renders list', () => {
  const out = renderMarkdown('- one\n- two');
  assert.ok(out.includes('<ul>'));
  assert.ok(out.includes('<li>one</li>'));
  assert.ok(out.includes('<li>two</li>'));
});

// ── escapeHtml unit ──────────────────────────────────────────────────

test('escapeHtml escapes all five metacharacters', () => {
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});

test('escapeHtml handles null/undefined as empty', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
