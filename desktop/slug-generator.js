const { spawn: defaultSpawn } = require('node:child_process');

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Cold-start of `claude -p` adds ~5–7s of CLI overhead before any LLM work,
// so the timeout has to be generous even for trivial prompts.
const DEFAULT_TIMEOUT_MS = 30000;
// Pin a fast model — slug generation is a trivial transformation. Update when
// the latest Haiku ID changes.
const MODEL = 'claude-haiku-4-5-20251001';

const PROMPT_TEMPLATE = (title) =>
  `Generate a URL slug for this blog post title. ` +
  `Output ONLY the slug — lowercase, kebab-case, English ASCII letters/digits/hyphens, ` +
  `no quotes, no explanation, no trailing punctuation, no leading or trailing whitespace. ` +
  `Title: ${title}`;

function buildPrompt(title) {
  return PROMPT_TEMPLATE(title);
}

function generateSlug({ title, spawnFn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!title || typeof title !== 'string' || !title.trim()) {
      reject(new Error('title is required'));
      return;
    }

    const child = spawnFn('claude', ['-p', '--model', MODEL, buildPrompt(title)]);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`claude -p timed out after ${timeoutMs}ms`)));
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
      // Take the first non-empty line: tolerates trailing prose injected by the
      // user's CLAUDE.md / voice-briefing rules etc. A slug is one token by definition.
      const slug = stdout.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
      if (!SLUG_PATTERN.test(slug)) {
        settle(() => reject(new Error(`invalid slug format: ${JSON.stringify(slug)}`)));
        return;
      }
      settle(() => resolve(slug));
    });
  });
}

module.exports = { generateSlug, buildPrompt, SLUG_PATTERN, DEFAULT_TIMEOUT_MS, MODEL };
