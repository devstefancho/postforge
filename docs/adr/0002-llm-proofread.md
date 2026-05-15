---
status: accepted
---

# LLM-Backed Proofread for Post Body

## Context

Users want to clean up Korean spelling, spacing, and grammar across an entire **Post** body without paying for a separate proofreading service. The body is markdown that frequently mixes prose with code fences, inline code, and URLs — a naive "run an LLM over the whole string" approach corrupts those structures and silently destroys code samples.

## Decision

A **Proofread** is an explicit, user-triggered correction pass over a whole **Post** body:

- **Trigger**: a header button (also bindable to a keyboard shortcut). No autorun on save or typing.
- **Scope**: spelling + spacing + particles + grammar. Stylistic rewriting is out of scope.
- **Model**: pinned to Sonnet (`claude-sonnet-4-6`) — Korean grammar is subtle enough that Haiku misses too much. Pinning is per-feature: **Slug** generation stays on Haiku.
- **Input boundary**: code fences, inline code, and URLs inside `[text](url)` / `![alt](path)` are extracted, substituted with opaque placeholders, sent to the LLM, and restored on the way back. A response missing or corrupting any placeholder is rejected.
- **Output UX**: a modal opens with a diff (changed regions highlighted) and `Apply All` / `Cancel`. There is no per-change accept/reject in the first version.
- **Wait UX**: the editor is disabled behind the modal. A `Cancel` button sends `SIGTERM` to the `claude` child process.
- **Size guard**: above ~10 000 characters, a confirm dialog warns about the expected wait before the call fires.
- **Reverting an apply**: clicking `Apply All` stashes the pre-correction body in `localStorage`. A `Revert proofread` button stays in the header until the next save or next **Proofread**, at which point the backup is dropped.
- **Failure on validation**: a corrupted placeholder restore fails the proofread entirely with a clear error — no automatic retry, no partial apply.

## Considered Options

- **Inline suggestions, Grammarly-style** — rejected: the editor is a plain `<textarea>`. Achieving inline underlines requires replacing the editor with CodeMirror/Monaco, an order of magnitude more work than the feature.
- **Per-change accept/reject in the diff** — rejected for v1: Korean text has no obvious change-unit (character / word / sentence each have failure modes), and the LLM would need structured JSON output, which is less reliable than plain text. The all-or-nothing modal can evolve into per-change later without redoing the pipeline.
- **Direct in-place replacement (no diff modal)** — rejected: body replacement is destructive over hundreds of words; users should see the changes before committing.
- **Background / non-modal mode** — rejected: it produces a race where the user edits during the call and the proofread result is stale on return. Modal + disabled editor eliminates the race.
- **Markdown AST extraction (markdown-it)** — rejected: introduces a parser dependency and trees of complexity for what placeholder substitution covers in ~50 lines.
- **Haiku for proofread too** — rejected: speed is acceptable cost for quality on this task. Latency is hidden behind an explicit click and a cancelable modal.
- **Hard size cap** — rejected: the right cap is hard to pin without data. A soft confirm dialog lets the user decide while still warning about cost/time.

## Consequences

- The desktop app's reliance on a local `claude` CLI deepens — Sonnet is required, not just Haiku.
- Proofread calls can take 30–90 seconds. The modal + cancel pattern keeps this acceptable, but a future iteration may want streaming output for perceived progress.
- The placeholder scheme is a small, dedicated module — if a future structure must be protected (e.g. LaTeX math, custom shortcodes), it's a one-line addition to the substitution table plus a regex.
- The `localStorage` revert key is one global slot per session. Concurrent **Posts** in separate windows is not a concern in the current single-window app.
- Per-change accept/reject is intentionally deferred. If user feedback shows the all-or-nothing modal causes them to reject useful corrections to avoid one bad one, that's the signal to invest.
