---
status: accepted
---

# LLM-Generated Slug from Title

## Context

A **Slug** in PostForge is the **permanent identifier** of a **Post**: it is the DB key, the URL path, and the image directory name. Users find it tedious to compose one by hand, especially when titles are in Korean and the slug must be English kebab-case. Simple romanization (e.g. `리액트 훅 정리` → `riaegteu-hug-jeongri`) produces strings that are unreadable and useless for SEO.

## Decision

When a **Trigger Action** (Save or Image Upload) fires on a **Post** whose **Slug** field is empty *and* which has not yet been saved, the Electron main process shells out to the locally installed `claude -p --model <haiku>` CLI with the title as input and uses the first non-empty stdout line after validating it against `/^[a-z0-9]+(-[a-z0-9]+)*$/`. Haiku is pinned for speed; cold-start CLI overhead alone is ~5–7s, so the timeout is 30s.

- **Where**: Electron main process via IPC. The Express server has no dependency on the Claude CLI.
- **When**: Only when the slug field is empty *and* the post is unsaved. After first save the slug is locked.
- **On failure** (CLI missing, network, timeout, invalid output): show a status message and let the user type the slug by hand.
- **On collision** (returned slug already exists): same as failure — surface a message with the LLM result pre-filled so the user can adjust.
- **During the call**: disable the Save button and display "Generating slug..." in the status bar.

## Considered Options

- **Hangul romanization library** — rejected: produces meaningless strings for the URL/SEO use case.
- **Server endpoint that calls `claude -p`** — rejected: pushes a user-environment dependency (Claude CLI + auth) into the API layer, complicating any future non-desktop deployment.
- **Generate on title `blur` instead of on Save** — rejected by the user in favor of save-time generation; the cost is that image upload had to be added as an extra trigger so users aren't blocked from inserting images before a first save.
- **Auto-regenerate slug whenever the title changes** — rejected: the slug is the identity of the post, not a derived view of the title. Repeated regeneration burns tokens, introduces races, and makes the slug feel unstable. Users can clear the field to force a new generation.
- **Auto-append `-2`, `-3` on collision** — rejected: produces ugly URLs and hides the collision from the user, who is usually in the best position to choose a meaningfully distinct slug.

## Consequences

- The desktop app gains a soft runtime dependency: a working `claude` CLI in the user's `PATH`. The failure path (manual entry) keeps the app usable when it is absent, but the headline feature degrades.
- Save latency increases by ~1–2 seconds on the first save of a new post. Subsequent saves of the same post are unaffected because the slug is already set.
- Slug remains immutable after first save by design. A future "rename slug" feature would have to rename the image directory, rewrite image references in the post body, and update the DB key in a single transaction — explicitly out of scope here.
