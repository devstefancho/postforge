const { spawn: defaultSpawn } = require('node:child_process');

// See CONTEXT.md (Proofread, Protected Segment) and docs/adr/0002-llm-proofread.md.

const MODEL = 'claude-sonnet-4-6';
// Sonnet on a multi-thousand-char body can take 30–90s; cold start adds a few more.
const DEFAULT_TIMEOUT_MS = 180000;
const SIZE_WARN_THRESHOLD = 10000;

// Sentinel tokens. The shape is deliberately unusual so the LLM is unlikely
// to introduce or alter them while writing prose corrections.
const TOKEN = (n) => `‹‹PFG${n}››`;
const TOKEN_RE = /‹‹PFG\d+››/g;

const PROMPT_PREFIX =
  'You are proofreading Korean text. Fix only: spelling, spacing (띄어쓰기), particles ' +
  '(조사 such as 은/는/이/가/을/를), and grammar. Do NOT rewrite for style, voice, ' +
  'clarity, or length. Preserve all markdown structure (headings, lists, blockquotes, ' +
  'emphasis, tables). Preserve every «PFG…» token verbatim — they are placeholders ' +
  'standing in for code and URLs that MUST NOT be changed, removed, duplicated, or ' +
  'rewritten in any way. Output ONLY the corrected text, no explanation, no preamble, ' +
  'no trailing commentary.\n\nText to proofread:\n';

function buildPrompt(protectedText) {
  return PROMPT_PREFIX + protectedText;
}

// Extract structural segments that must not be modified by the LLM.
// Returns { protectedText, placeholders } where placeholders[i] is the original
// substring for token ‹‹PFGi››.
//
// Order matters: fenced code first (so its content isn't shredded by the
// inline-code regex), then inline code, then markdown links/images.
function protect(body) {
  const placeholders = [];
  const allocate = (original) => {
    const id = placeholders.length;
    placeholders.push(original);
    return TOKEN(id);
  };

  let out = body;
  out = out.replace(/```[\s\S]*?```/g, (m) => allocate(m));
  out = out.replace(/`[^`\n]+`/g, (m) => allocate(m));
  // Protect only the URL portion of [text](url) / ![alt](path) so link text
  // remains correctable. The brackets and parens are markdown structure.
  out = out.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (_full, bracket, url) =>
    `${bracket}(${allocate(url)})`
  );

  return { protectedText: out, placeholders };
}

// Restore placeholders. Returns null if any token is missing, duplicated, or
// if unknown ‹‹PFGn›› tokens (with n out of range) appear — any of these
// means the LLM corrupted the protected segments.
function restore(text, placeholders) {
  for (let i = 0; i < placeholders.length; i++) {
    const token = TOKEN(i);
    const occurrences = text.split(token).length - 1;
    if (occurrences !== 1) return null;
  }
  // Detect tokens the LLM may have invented (e.g. PFG99 when we only had 3).
  const found = text.match(TOKEN_RE) || [];
  if (found.length !== placeholders.length) return null;

  let out = text;
  for (let i = 0; i < placeholders.length; i++) {
    out = out.replace(TOKEN(i), () => placeholders[i]);
  }
  return out;
}

function proofread({
  body,
  spawnFn = defaultSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    if (typeof body !== 'string' || !body.trim()) {
      reject(new Error('body is required'));
      return;
    }
    if (signal?.aborted) {
      reject(new Error('proofread cancelled'));
      return;
    }

    const { protectedText, placeholders } = protect(body);
    const child = spawnFn('claude', ['-p', '--model', MODEL, buildPrompt(protectedText)]);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; cleanup(); fn(); } };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`proofread timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
      settle(() => reject(new Error('proofread cancelled')));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    child.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? 'claude CLI not found in PATH'
        : `claude CLI failed to start: ${err.message}`;
      settle(() => reject(new Error(msg)));
    });

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        settle(() => reject(new Error(
          `claude -p exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
        )));
        return;
      }
      const candidate = stdout.trim();
      if (!candidate) {
        settle(() => reject(new Error('claude returned an empty response')));
        return;
      }
      const restored = restore(candidate, placeholders);
      if (restored === null) {
        settle(() => reject(new Error('protected segments were corrupted in the response')));
        return;
      }
      settle(() => resolve(restored));
    });
  });
}

module.exports = {
  protect,
  restore,
  proofread,
  buildPrompt,
  MODEL,
  DEFAULT_TIMEOUT_MS,
  SIZE_WARN_THRESHOLD,
};
