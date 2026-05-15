# PostForge

A local-first blog post editor (Electron desktop + Express/SQLite server) that manages markdown posts and their associated images.

## Language

**Post**:
A markdown blog entry with metadata (title, description, tags, hero image, etc.) and a draft/published state. Identified by its **Slug**.
_Avoid_: Article, entry, page

**Slug**:
A short URL-safe string (kebab-case, lowercase ASCII) that serves as the **permanent identifier** of a **Post**. It simultaneously acts as the DB primary lookup key, the URL path, and the directory name for that post's images (`posts/<slug>/<filename>`). Set once at first save and never changed afterward.
_Avoid_: ID, key, permalink

**Trigger Action**:
A user action that requires a **Slug** to proceed — currently *Save* and *Image Upload*. If the **Slug** field is empty and the post has not yet been saved, the trigger fires LLM-based slug generation (see [ADR-0001](./docs/adr/0001-llm-generated-slug.md)).

**Draft**:
A **Post** with `is_draft = true`. Stored in the same table as published posts; the difference is purely the flag and the filtering in list endpoints.
_Avoid_: Unpublished, work-in-progress

**Proofread**:
A user-initiated, whole-body correction pass over a **Post** for Korean spelling, spacing, particles, and grammar. It explicitly does *not* rewrite for style or voice. Produces a candidate body shown in a diff modal that the user accepts (all-or-nothing) or cancels. See [ADR-0002](./docs/adr/0002-llm-proofread.md).
_Avoid_: Edit, rewrite, correction (these are too broad)

**Protected Segment**:
A region of a **Post** body that must remain byte-identical through a **Proofread** — currently fenced code blocks, inline code, and URLs inside `[text](url)` / `![alt](path)`. The system substitutes opaque placeholders for these segments before calling the LLM and restores them after; a missing or corrupted placeholder in the response invalidates the **Proofread**.

## Relationships

- A **Post** is uniquely identified by its **Slug**
- A **Post**'s images live in a directory named after its **Slug**
- A **Trigger Action** on a **Post** without a **Slug** generates one from its **Title** (only before first save)
- A **Draft** is a state of a **Post**, not a separate entity
- A **Proofread** operates on a **Post**'s body, treating all **Protected Segments** as immutable
- A **Proofread** result is reversible until the next *Save* or next **Proofread**

## Example dialogue

> **User:** "I changed my mind about the title — can I regenerate the **Slug**?"
> **Designer:** "Only if the **Post** hasn't been saved yet. Once it has, the **Slug** is the URL, the image directory, and the DB key — changing it would require renaming the directory and rewriting every image reference in the body. Before first save, you can clear the **Slug** field and a **Trigger Action** will produce a fresh one."

> **User:** "I ran **Proofread** and one of my code samples got rewritten — what?"
> **Designer:** "That shouldn't happen — code fences are **Protected Segments**. If it did, the placeholder restore step would have caught a missing token and refused the result. If the modal showed the change anyway, the protection rules need to be widened (e.g. an indented code block instead of a fenced one)."

## Flagged ambiguities

- "Slug" sometimes informally refers to "a URL-friendly version of a name." Here it is stricter: it is the **identity** of a **Post**, not a decoration on top of one.
