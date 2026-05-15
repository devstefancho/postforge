---
status: accepted
---

# LLM-Generated Description from Title + Body

## Context

Users routinely leave the **Description** field empty when saving — same root cause as the empty **Slug** problem ADR-0001 addressed: it is tedious to compose a 1–2 sentence Korean summary by hand after writing the full post. An empty description leaves dashboard cards visually flat and removes useful SEO context. The field is also an input that downstream features (notably **Hero Image** auto-generation, ADR-0004) depend on for prompt quality.

## Decision

**Description** becomes an **Auto-Filled Field** (see CONTEXT.md). On *Save*, after **Slug** generation (if any) settles, the Electron main process shells out to `claude -p --model claude-sonnet-4-6` with `Title + body` and writes the first non-empty trimmed line into the **Post**'s `description` column.

- **Where**: Electron main process via IPC, same channel as ADR-0001. The Express server has no dependency on the Claude CLI.
- **When**: Only when `description` is empty at *Save* time. If the user typed any non-whitespace description, the call is skipped.
- **Model**: pinned to Sonnet (`claude-sonnet-4-6`). Korean summarization is nuanced enough that Haiku produces blander, less faithful summaries; consistent with ADR-0002's Sonnet pinning for Korean grammar work.
- **Sync**: synchronous step in the Save flow. It blocks the Save response, like **Slug** generation. Adds ~3–5s of latency on saves where the field is empty.
- **Body content**: passed verbatim — no **Protected Segment** placeholder substitution (ADR-0002). The output is a single description line, not a body rewrite, so code blocks/URLs in the body are *input context* and don't risk corruption.
- **Length guidance**: prompt explicitly requests one or two sentences in Korean. Output longer than ~300 chars is truncated at the last sentence boundary client-side.
- **On failure** (CLI missing, timeout, empty stdout): silent — `description` stays empty, *Save* still succeeds, and the next *Save* will try again. No status-bar shouting; the failure is non-blocking.
- **User edits**: once the field is non-empty (whether auto-filled or hand-typed), it is a regular field. Clearing it and saving re-triggers auto-fill. There is no "auto-generated" flag on the column.

## Considered Options

- **Haiku for description too** — rejected: ADR-0002 already established that Korean grammar/summarization is Sonnet-quality work. Haiku's speed gain (~2s) is small relative to the total Save flow and doesn't justify summary quality regressions.
- **Async like Hero (ADR-0004)** — rejected: **Description** is visible text that the user wants to inspect/edit immediately after saving. An async description means the Save response returns with the field blank and a moment later it pops in — disorienting and racy with the user's next interaction (especially if they re-open the post).
- **Generate on Title-blur instead of on Save** — rejected: same reasoning as ADR-0001. Mid-typing regeneration burns tokens and feels unstable.
- **Apply Protected Segment placeholders to the body input** — rejected as unnecessary: the output is a description line that the model produces independently, not a transformation of the body. The placeholder machinery exists to protect *output structure*, which isn't at risk here.
- **Truncate body to first 500 chars before sending** — rejected: long-form posts have important content past the intro that a faithful summary should reflect. Token cost on a typical post is bounded enough that capping isn't worth the summary regression.
- **Mark auto-filled descriptions with a flag (so the user knows it's not theirs)** — rejected: it adds DB shape and UI affordances without unlocking any user need we know of. If "is this auto-filled?" becomes a real question, add it then.

## Consequences

- *Save* latency increases by ~3–5s when description is empty. Combined with **Slug** generation (also ~5–7s on first save), a first-save of a long Korean post can take ~10s before the response. Acceptable per ADR-0001's already-established baseline.
- The desktop app's reliance on a local `claude` CLI deepens further: both Haiku (slug) and Sonnet (proofread + description) must be reachable.
- **Hero Image** auto-generation (ADR-0004) can now assume `description` is non-empty at the point its background job starts.
- Auto-filled descriptions are indistinguishable in DB shape from user-typed ones. A user who wants a fresh one clears the field and saves; no special "regenerate description" button is needed in v1.
