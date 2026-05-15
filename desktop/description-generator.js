const { spawn: defaultSpawn } = require('node:child_process');

// See CONTEXT.md (Description, Auto-Filled Field) and docs/adr/0003-llm-generated-description.md.

const MODEL = 'claude-sonnet-4-6';
// Sonnet on a short summarization with full body input is typically 3–6s;
// cold start adds a few more. 60s leaves slack for long posts.
const DEFAULT_TIMEOUT_MS = 60000;
// Truncate at the last sentence boundary if output runs long.
const MAX_LEN = 300;

const PROMPT_PREFIX =
  'You are writing a one or two sentence Korean summary (description) for a blog post. ' +
  'Output ONLY the description text in Korean — no preamble, no quotes, no markdown, ' +
  'no trailing commentary. Aim for 1–2 sentences that capture the post\'s subject and ' +
  'point of view. Keep it under 300 characters.\n\n';

function buildPrompt(title, body) {
  return `${PROMPT_PREFIX}Title: ${title}\n\nBody:\n${body}`;
}

function truncateAtSentence(text, max = MAX_LEN) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('다.'),
    slice.lastIndexOf('요.'),
  );
  if (lastEnd > max * 0.5) {
    return slice.slice(0, lastEnd + 1).trim();
  }
  return slice.trim();
}

function generateDescription({
  title,
  body,
  spawnFn = defaultSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!title || typeof title !== 'string' || !title.trim()) {
      reject(new Error('title is required'));
      return;
    }
    if (typeof body !== 'string' || !body.trim()) {
      reject(new Error('body is required'));
      return;
    }

    const child = spawnFn('claude', ['-p', '--model', MODEL, buildPrompt(title, body)]);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`description generation timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const msg = err.code === 'ENOENT'
        ? 'claude CLI not found in PATH'
        : `claude CLI failed to start: ${err.message}`;
      settle(() => reject(new Error(msg)));
    });

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle(() => reject(new Error(
          `claude -p exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
        )));
        return;
      }
      // Take the first non-empty line; tolerates trailing prose from CLAUDE.md
      // voice-briefing rules etc. A description is one paragraph by design.
      const line = stdout.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
      if (!line) {
        settle(() => reject(new Error('claude returned an empty description')));
        return;
      }
      settle(() => resolve(truncateAtSentence(line)));
    });
  });
}

module.exports = {
  generateDescription,
  buildPrompt,
  truncateAtSentence,
  MODEL,
  DEFAULT_TIMEOUT_MS,
  MAX_LEN,
};
