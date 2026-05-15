// See CONTEXT.md (Hero Image, Auto-Filled Field) and docs/adr/0004-gemini-auto-hero-image.md.

// Imagen via `generateImages` is the path that honors `aspectRatio` as a
// first-class parameter; Gemini image models via `generateContent` ignore the
// field and default to square output.
const MODEL = 'imagen-4.0-fast-generate-001';
const ASPECT_RATIO = '16:9';
const DEFAULT_TIMEOUT_MS = 60000;
const ENV_KEY = 'GEMINI_API_KEY';

// Phrasing is calibrated for Imagen 4. Two lessons from live runs:
//  (a) "blog hero" or "banner" prompts the model into a layout mockup with
//      headline text — avoided by labeling the output "wallpaper-style
//      background illustration".
//  (b) Imagen ignores the Vertex `negativePrompt` field over the Gemini API,
//      so prohibitions live inside the prompt body and lean on positive
//      framing ("pure shape language", "geometric only") more than "no X".
const STYLE =
  'a fully abstract wallpaper-style background illustration, ' +
  'composed only of soft pastel geometric shapes and gentle organic curves, ' +
  'flat editorial style, calm symmetric composition, ' +
  'pure shape language with no text, no letters, no characters, no glyphs, ' +
  'no humans, no faces, no silhouettes, no figures, ' +
  'no UI, no logos, no watermarks, ' +
  '16:9 wide landscape framing';

function buildPrompt({ topic, title, description, tags = [], category = '' } = {}) {
  // When a translated English `topic` is provided (the chain path), feed
  // ONLY that to Imagen. Korean text inside the prompt is what triggers the
  // ghost-glyph artifact, so we deliberately drop the raw fields.
  if (typeof topic === 'string' && topic.trim().length > 0) {
    return (
      `${STYLE}.\n\n` +
      `Mood reference (use only as conceptual inspiration for color and shape, ` +
      `not as content to depict literally):\n` +
      `Topic: ${topic.trim()}`
    );
  }
  const tagLine = tags.length ? `\nTags: ${tags.join(', ')}` : '';
  const catLine = category ? `\nCategory: ${category}` : '';
  const descLine = description ? `\nDescription: ${description}` : '';
  return (
    `${STYLE}.\n\n` +
    `Mood reference (use only as conceptual inspiration for color and shape, ` +
    `not as content to depict literally):\n` +
    `Title: ${title}${descLine}${tagLine}${catLine}`
  );
}

function hasApiKey(env = process.env) {
  const v = env[ENV_KEY];
  return typeof v === 'string' && v.trim().length > 0;
}

function defaultClientFactory(apiKey) {
  // Lazy-require so tests that pass clientFactory don't need the SDK installed.
  const { GoogleGenAI } = require('@google/genai');
  return new GoogleGenAI({ apiKey });
}

function extractFirstGeneratedImage(response) {
  const list = response?.generatedImages ?? [];
  for (const item of list) {
    const bytes = item?.image?.imageBytes;
    if (typeof bytes === 'string' && bytes.length > 0) {
      return {
        base64: bytes,
        mimeType: item.image.mimeType || 'image/png',
      };
    }
  }
  return null;
}

async function generateHero({
  topic,
  title,
  description = '',
  tags = [],
  category = '',
  env = process.env,
  clientFactory = defaultClientFactory,
  model = MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const hasTopic = typeof topic === 'string' && topic.trim().length > 0;
  if (!hasTopic && (!title || typeof title !== 'string' || !title.trim())) {
    throw new Error('topic or title is required');
  }
  if (!hasApiKey(env)) {
    throw new Error(`${ENV_KEY} is not set`);
  }

  const client = clientFactory(env[ENV_KEY]);
  const prompt = buildPrompt({ topic, title, description, tags, category });

  const call = client.models.generateImages({
    model,
    prompt,
    config: {
      aspectRatio: ASPECT_RATIO,
      numberOfImages: 1,
      outputMimeType: 'image/png',
    },
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`hero generation timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  let response;
  try {
    response = await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }

  const image = extractFirstGeneratedImage(response);
  if (!image) {
    throw new Error('Gemini returned no image data');
  }
  return image;
}

module.exports = {
  generateHero,
  buildPrompt,
  hasApiKey,
  extractFirstGeneratedImage,
  MODEL,
  ASPECT_RATIO,
  DEFAULT_TIMEOUT_MS,
  ENV_KEY,
  STYLE,
};
