const { spawn: defaultSpawn } = require('node:child_process');

// See docs/adr/0004-gemini-auto-hero-image.md.
//
// Why this module exists: Imagen draws "ghost glyphs" — broken non-Latin
// characters scattered around the canvas — whenever the prompt itself
// contains Korean text (Title, Description, tags). Compressing the inputs
// down to a single English phrase before the Imagen call removes the
// trigger entirely. Haiku is more than enough for "summarize this in
// 1 short English phrase".

const MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 30000;

const PROMPT_PREFIX =
  'Summarize the following Korean blog post metadata as ONE short English ' +
  'noun phrase (5–12 words) describing the post\'s subject. Output ONLY the ' +
  'phrase — no quotes, no preamble, no trailing prose, no Korean characters, ' +
  'no punctuation other than spaces and hyphens.\n\n';

function buildPrompt({ title, description = '', tags = [], category = '' } = {}) {
  const tagLine = tags.length ? `\nTags: ${tags.join(', ')}` : '';
  const catLine = category ? `\nCategory: ${category}` : '';
  const descLine = description ? `\nDescription: ${description}` : '';
  return `${PROMPT_PREFIX}Title: ${title}${descLine}${tagLine}${catLine}`;
}

function translateTopic({
  title,
  description = '',
  tags = [],
  category = '',
  spawnFn = defaultSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!title || typeof title !== 'string' || !title.trim()) {
      reject(new Error('title is required'));
      return;
    }

    const prompt = buildPrompt({ title, description, tags, category });
    const child = spawnFn('claude', ['-p', '--model', MODEL, prompt]);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`topic translation timed out after ${timeoutMs}ms`)));
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
      const phrase = stdout.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
      if (!phrase) {
        settle(() => reject(new Error('claude returned an empty topic phrase')));
        return;
      }
      settle(() => resolve(phrase));
    });
  });
}

module.exports = {
  translateTopic,
  buildPrompt,
  MODEL,
  DEFAULT_TIMEOUT_MS,
};
