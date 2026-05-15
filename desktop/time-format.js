// Dual-mode module: usable as a browser global (loaded via <script src>)
// in editor.html and as a CommonJS module under node:test.

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatElapsed };
}
