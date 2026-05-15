const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateHero,
  buildPrompt,
  hasApiKey,
  extractFirstGeneratedImage,
  ASPECT_RATIO,
  MODEL,
  ENV_KEY,
} = require('./hero-generator');

function makeClient(behavior) {
  return () => ({
    models: {
      generateImages: async (req) => {
        if (behavior.capture) behavior.capture(req);
        if (behavior.delayMs) {
          await new Promise((r) => setTimeout(r, behavior.delayMs));
        }
        if (behavior.error) throw behavior.error;
        return behavior.response;
      },
    },
  });
}

const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const OK_RESPONSE = {
  generatedImages: [
    { image: { imageBytes: SAMPLE_PNG_B64, mimeType: 'image/png' } },
  ],
};

test('returns base64 PNG when Imagen responds with imageBytes', async () => {
  const result = await generateHero({
    title: '리액트 훅 정리',
    description: '리액트 훅의 핵심 정리.',
    tags: ['react', 'hooks'],
    env: { GEMINI_API_KEY: 'fake' },
    clientFactory: makeClient({ response: OK_RESPONSE }),
  });
  assert.equal(result.base64, SAMPLE_PNG_B64);
  assert.equal(result.mimeType, 'image/png');
});

test('passes pinned model, 16:9 aspect ratio, PNG mime, and prompt string', async () => {
  let captured;
  await generateHero({
    title: 't',
    description: 'd',
    tags: ['x'],
    category: 'blog',
    env: { GEMINI_API_KEY: 'k' },
    clientFactory: makeClient({
      response: OK_RESPONSE,
      capture: (req) => { captured = req; },
    }),
  });
  assert.equal(captured.model, MODEL);
  assert.equal(captured.config.aspectRatio, ASPECT_RATIO);
  assert.equal(captured.config.numberOfImages, 1);
  assert.equal(captured.config.outputMimeType, 'image/png');
  assert.equal(captured.config.negativePrompt, undefined);
  assert.equal(typeof captured.prompt, 'string');
  assert.match(captured.prompt, /Title: t/);
  assert.match(captured.prompt, /Description: d/);
  assert.match(captured.prompt, /Tags: x/);
  assert.match(captured.prompt, /Category: blog/);
});

test('rejects when GEMINI_API_KEY is missing', async () => {
  await assert.rejects(
    generateHero({
      title: 't',
      env: {},
      clientFactory: () => assert.fail('client should not be constructed'),
    }),
    new RegExp(`${ENV_KEY} is not set`)
  );
});

test('rejects when GEMINI_API_KEY is whitespace', async () => {
  await assert.rejects(
    generateHero({
      title: 't',
      env: { GEMINI_API_KEY: '   ' },
      clientFactory: () => assert.fail('client should not be constructed'),
    }),
    new RegExp(`${ENV_KEY} is not set`)
  );
});

test('rejects when neither topic nor title is provided', async () => {
  await assert.rejects(
    generateHero({
      title: '  ',
      env: { GEMINI_API_KEY: 'k' },
      clientFactory: makeClient({ response: OK_RESPONSE }),
    }),
    /topic or title is required/
  );
});

test('uses topic-only prompt and drops raw Korean fields when topic is provided', async () => {
  let captured;
  await generateHero({
    topic: 'minimalist abstract art for react hooks summary',
    title: '리액트 훅 정리',
    description: '한국어 설명',
    tags: ['리액트'],
    env: { GEMINI_API_KEY: 'k' },
    clientFactory: makeClient({
      response: OK_RESPONSE,
      capture: (req) => { captured = req; },
    }),
  });
  assert.match(captured.prompt, /Topic: minimalist abstract art/);
  assert.doesNotMatch(captured.prompt, /리액트/);
  assert.doesNotMatch(captured.prompt, /한국어/);
  assert.doesNotMatch(captured.prompt, /Title:/);
});

test('rejects when Imagen returns no image data', async () => {
  await assert.rejects(
    generateHero({
      title: 't',
      env: { GEMINI_API_KEY: 'k' },
      clientFactory: makeClient({ response: { generatedImages: [] } }),
    }),
    /no image data/
  );
});

test('rejects when client throws', async () => {
  await assert.rejects(
    generateHero({
      title: 't',
      env: { GEMINI_API_KEY: 'k' },
      clientFactory: makeClient({ error: new Error('quota exhausted') }),
    }),
    /quota exhausted/
  );
});

test('rejects on timeout', async () => {
  await assert.rejects(
    generateHero({
      title: 't',
      env: { GEMINI_API_KEY: 'k' },
      clientFactory: makeClient({ delayMs: 200, response: OK_RESPONSE }),
      timeoutMs: 30,
    }),
    /timed out after 30ms/
  );
});

test('hasApiKey true only for non-empty string', () => {
  assert.equal(hasApiKey({ GEMINI_API_KEY: 'x' }), true);
  assert.equal(hasApiKey({ GEMINI_API_KEY: '' }), false);
  assert.equal(hasApiKey({ GEMINI_API_KEY: '   ' }), false);
  assert.equal(hasApiKey({}), false);
});

test('extractFirstGeneratedImage returns null when no images', () => {
  assert.equal(extractFirstGeneratedImage({ generatedImages: [] }), null);
  assert.equal(extractFirstGeneratedImage({ generatedImages: [{}] }), null);
  assert.equal(extractFirstGeneratedImage({}), null);
  assert.equal(extractFirstGeneratedImage(null), null);
});

test('buildPrompt anchors style with abstract wallpaper framing, prohibitions, and 16:9', () => {
  const p = buildPrompt({ title: 'x' });
  assert.match(p, /abstract/);
  assert.match(p, /wallpaper/);
  assert.match(p, /16:9/);
  assert.match(p, /no text/);
  assert.match(p, /no humans/);
});

test('buildPrompt handles missing description/tags/category gracefully', () => {
  const p = buildPrompt({ title: 'only-title' });
  assert.match(p, /Title: only-title/);
  assert.doesNotMatch(p, /Description:/);
  assert.doesNotMatch(p, /Tags:/);
  assert.doesNotMatch(p, /Category:/);
});
