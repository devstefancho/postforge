---
status: accepted
---

# Gemini-Generated Hero Image from Description

## Context

Users routinely leave the **Hero Image** empty when publishing — same procrastination pattern as the empty **Slug** (ADR-0001) and empty **Description** (ADR-0003). An empty hero leaves dashboard cards visually flat. Image generation, unlike text, takes 10–30s end-to-end, which makes the ADR-0001/0003 "block the Save response" pattern unacceptable for this step.

## Decision

**Hero Image** becomes an **Auto-Filled Field** generated *asynchronously* during *Save*. The Electron main process calls the Gemini image SDK (`@google/genai`) directly — no CLI shell-out, in deliberate departure from ADR-0001/0003's `claude -p` pattern, because the official `gemini` CLI is a text agent and does not write image files to disk.

- **Where**: Electron main process via IPC. The Express server has no dependency on Gemini. The Save HTTP request returns immediately after the synchronous chain (Slug + Description); the hero job is dispatched as a fire-and-forget Promise in main.
- **When**: After every *Save* where `hero_image` is empty. No first-save lock — clearing the field and saving re-triggers auto-fill. Drafts and published posts behave identically.
- **Chain input (v1 default)**: `Title + Description + tags + category`. **Description** is guaranteed non-empty at this point thanks to ADR-0003. If somehow it is still empty (description generation failed silently), the hero job falls back to `Title + tags`. The exact field mix is a tweakable prompt-template detail in the implementation PR — not a load-bearing decision in this ADR.
- **Pre-step: Korean → English topic compression.** Before the Imagen call, the chain runs the inputs through Claude Haiku to produce one short English noun phrase, and the Imagen prompt receives *only that phrase* (plus the style block). Reason: Imagen, when its prompt contains Korean text, sprinkles broken non-Latin glyph fragments across the canvas — even with explicit "no text" instructions and the negative prompt. Stripping Korean from the prompt removes the trigger. Adds ~2–4s to the (already async, user-invisible) hero job. Implemented as `hero-topic-translator.js` mirroring the `slug-generator` shape.
- **Model**: pinned to a current Gemini image model (e.g. `gemini-3.1-flash-image-preview`). Pinning is per-feature, consistent with ADR-0001/0002. Update when the model name changes.
- **Output**: 16:9, written to `posts/<slug>/hero.png` and `hero_image` column updated to `posts/<slug>/hero.png`. Path collides intentionally with manual-upload's `hero.<ext>` convention — auto and manual are the same field.
- **Style**: abstract / minimalist illustration. A single style template lives in main process code (no per-post selection in v1). The prompt template injects `Title + Description + tags` and asks for "an abstract minimalist illustration evoking the topic, no text in the image, no human faces, soft palette, suitable as a blog hero."
- **API key**: read from `GEMINI_API_KEY` in `.env`. If missing or empty at process startup, hero auto-generation is **disabled** silently — *Save* still succeeds, just with no hero job dispatched. A one-line note in the status bar on the first Save of a session ("GEMINI_API_KEY not set — hero auto-generation disabled") is the only signal; manual hero upload continues to work unchanged.
- **On failure** (network, model error, timeout, content filter rejection): silent — `hero_image` stays empty, no DB marker recorded, next *Save* re-tries. A non-blocking status-bar message ("Hero generation failed: <reason>") appears in the editor if the post is still open when the failure resolves. This is **cost-uncapped by design**: a permanently misconfigured key will produce one failed Gemini call per Save until the user fixes it. The user installed this feature *because* they were forgetting hero images; we trust that they will notice and fix a broken key faster than they will notice a forgotten hero.
- **Race condition acknowledgement**: if the user saves again at t=10s while a hero job from t=0 is in flight, the second save also dispatches a hero job (because `hero_image` is still empty in the DB). Whichever job finishes second wins the `hero_image` write. We accept this — both jobs see roughly the same `Title + Description`, so the visible result is just "one of two near-identical hero images." We do **not** add an in-flight lock in v1.
- **App close during job**: the in-memory Promise is dropped, no `hero_image` write happens, next *Save* will try again. This is a load-bearing simplifier — no job queue, no on-disk task state.
- **No "Regenerate hero" button in v1**: the existing manual-upload affordance already covers "replace with something specific"; clearing the hero (via a small "Clear" affordance to be added next to the hero preview) and saving covers "give me a different auto one." A dedicated regenerate button can come later if friction shows up in use.

## Considered Options

- **Use `gemini` CLI like ADR-0001 uses `claude` CLI** — rejected: the installed `gemini 0.37.2` is a text agent (`-p` mode returns prose, no file output). The CLI parity argument doesn't survive contact with what the CLI actually does.
- **Spawn Python `thumbnail-generator` (`uv run --with google-genai python ...`)** — rejected: ADR-0001's "minimize user-environment dependencies" principle still applies. Adding Python + uv to PostForge's runtime requirements complicates `electron-builder` packaging, and the YouTube thumbnail concepts (5 cinematic-tech variants) don't map onto blog heros anyway.
- **Synchronous like Description (block Save for 10–30s)** — rejected: too long. The user noted "I keep forgetting because it's tedious" — they would also start to dread the Save button.
- **"Pending hero" modal with Accept/Reject/Regenerate after generation** — rejected: it reintroduces the *interaction* whose absence was the whole point of automating. The user can always manually overwrite later if a particular hero is bad.
- **Per-post failure backoff (e.g. stop after 2 consecutive failures)** — rejected: adds DB column (`hero_failed_count`) and a separate "Regenerate" entry point. The cost-uncapped behavior is intentional: the user is the backoff signal.
- **Global cooldown after a failure (e.g. 5 min)** — rejected: conflates transient (network) and persistent (bad key) failures.
- **Settings UI with a master toggle for auto-hero** — rejected: PostForge has no Settings screen yet, and a missing/empty `GEMINI_API_KEY` already functions as the off switch. If a no-key user needs to opt out, leaving the key unset is the documented path.
- **Generate at *Publish* instead of every *Save*** — rejected: drafts also benefit from a placeholder hero (dashboard cards visible during the draft phase), and the same forgetfulness applies to publishing.
- **Mark auto-generated hero with a separate column** — rejected: auto and manual heros are functionally identical in the rest of the app; adding a flag would force every read path to care.

## Consequences

- The desktop app gains a new runtime dependency: `@google/genai` in `desktop/package.json`. This is the first non-`electron` dependency the desktop bundle ships with.
- The desktop app gains a new *configuration* dependency: `GEMINI_API_KEY` in `.env`. Onboarding docs (README) must mention this. Without it, the feature is silently disabled.
- Hero generation is **cost-uncapped on the user's Gemini quota**. A bad key plus daily writing means dozens of failed Gemini calls. The trade is intentional: the failure mode is visible (no hero appears) and self-correcting (the user fixes the key).
- The chain ordering — Slug → Description → Hero — means a worst-case first-save is roughly: ~5–7s (slug) + ~3–5s (description) sync, then Save returns; hero arrives ~10–30s later. Total user-perceived Save latency stays around the ADR-0001 baseline; hero is "free" from the user's wait-time perspective.
- The "no in-flight lock" race is a real but bounded ugliness. If it becomes a problem in practice (e.g. users report duplicate writes confusing the image cache), revisit with a per-post in-flight map keyed by slug.
- `hero.png` is overwritten in place on each successful generation. Browsers and the readonly view should cache-bust (e.g. `?v=<updated_at>` query) or this ADR has to come back and force a unique filename. Out of scope here — flagged for the implementation PR.
- Auto-fill always writes `hero.png`, but manual upload preserves the user's extension (`editor.html:1423` writes `hero.<ext>`). Clearing a manually uploaded `hero.jpg` and re-saving will leave the old `hero.jpg` as an orphan on disk alongside the new `hero.png`. Implementation PR must pick one of: (a) delete any existing `hero.*` when clearing the field, or (b) force all heros — manual and auto — to a single canonical extension. No data loss either way; this is filesystem hygiene.
- `.env` reading: PostForge's existing `.env` is read by the Express server (`server/`). Electron main must explicitly load it (e.g. via `dotenv` from the project root) for `GEMINI_API_KEY` to be reachable. Verify in the implementation PR.

