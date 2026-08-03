---
name: ai-memory
description: Use when starting any task or coding session. Load project memory from ai-memory/ folder (progress, architecture, decisions, context, tasks) at start. Update progress.md and tasks.md after every significant change. Keep architecture.md and decisions.md current when project structure or key decisions change. This vault is the single source of truth for the project state across all AI models (GPT, Gemini, Claude, Copilot).
triggers:
  - memory
  - hafiza
  - vault
  - hatirla
  - kaydet
  - durum
  - ilerleme
  - mimari
  - karar
  - gorev
  - context
  - roadmap
  - proje
  - project
  - recall
  - remember
  - forget
  - note
  - not
  - arsiv
  - ozet
  - consolidate
requires:
  vault_folder: true
  files:
    - progress.md
    - tasks.md
---

# AI Memory System

This skill connects the AI to the project's Obsidian-compatible memory vault.
The vault folder may be named `ai-memory/`, `<project>-ai-memory/`, or any
folder ending with `-ai-memory`. Search the project root for a folder matching
that pattern, then use it. If multiple are found, use the one with actual content.

## Startup (every session/call)

First, find the memory vault folder (any folder ending with `-ai-memory` in
project root). Then read ALL files inside it:

```
[MEMORY_FOLDER]/product.md      → PRD: purpose, target users, MVP features, out of scope
[MEMORY_FOLDER]/roadmap.md      → roadmap: phases, milestones, planned features
[MEMORY_FOLDER]/progress.md     → current state, last action, blockers
[MEMORY_FOLDER]/architecture.md → system design, modules, data flow
[MEMORY_FOLDER]/decisions.md    → past decisions and their reasons
[MEMORY_FOLDER]/context.md      → setup, env vars, commands, dependencies
[MEMORY_FOLDER]/tasks.md        → todo, in-progress, completed
[MEMORY_FOLDER]/changelog.md    → version history, what changed per version
[MEMORY_FOLDER]/memory/         → daily session notes (YYYY-MM-DD.md)
```

Also scan `[MEMORY_FOLDER]/memory/` for recent daily notes (last 7 days)
to recall what was discussed in previous sessions.

Use this information to understand where the project is, what was just done,
and what should happen next. This prevents re-solving solved problems and
keeps all models on the same page.

## Eligibility Check (before using this skill)

If the vault folder does not exist at all:
- Tell the user: "Vault bulunamadi. Bootstrap yapayim mi?"
- Do NOT proceed with vault operations

If `progress.md` or `tasks.md` is missing but other vault files exist:
- The vault may be corrupted; warn the user
- Try to continue with available files

## CRITICAL: Working Directory Check (after reading vault)

The vault may describe a **parent project** that lives above the current
working directory (`$CWD`). Before using vault data to answer "where do
you start" or "what folders exist" questions, verify that the folders
mentioned in `architecture.md` and `context.md` actually exist in `$CWD`:

1. Extract the main folder names from the vault (e.g. `mobile/`, `web/`,
   `web-admin/`, `db/`, `supabase/`, `docs/`)
2. Check if ANY of these folders exist in the current working directory
3. If **ALL** referenced folders are missing from `$CWD`:
   - The vault describes a parent project that is NOT the current directory
   - The user has likely opened only the vault folder in their editor
   - Tell the user: "Bu vault parent projeyi anlatiyor. Su anki calisma
     dizininde sadece vault dosyalari var. Kod uzerinde calismak icin
     ust dizini (parent project root) acin."
   - Do NOT list folders that don't exist in the current directory
   - Answer questions based on what IS in the current directory
4. If folders exist → vault matches the working directory, proceed normally

## TRANSPARENCY — always tell the user what you're doing with memory

After reading the vault at startup, briefly tell the user what you found:

> [MEMORY_FOLDER] okundu. Proje: [proje adi], Son durum: [progress.md ozeti], Siradaki: [tasks ozeti]

After writing any file to the vault, explicitly state it:

> [MEMORY_FOLDER] guncellendi: [dosya adi] → [ne yazildi]

This is non-negotiable. The user wants to SEE that the memory system is
working. Never read or write silently — always announce it.

## First-time bootstrap (empty vault)

If `progress.md` has no entries under "Son Yapilanlar" (the vault is empty),
run a one-time project scan and populate all files:

1. **Scan the project**: read package.json/Cargo.toml/pyproject.toml, main
   entry points, folder structure, existing README, config files
2. **Fill product.md**: extract purpose from README, fill MVP/scope sections
3. **Fill context.md**: extract dependencies, scripts/commands, env vars,
   folder structure. **Prepend** this parent note at the top (after frontmatter):
   > Bu vault, `../` (parent) dizindeki **[proje adi]** projesini referans alir. `mobile/`, `web/`, `src/` gibi klasorler parent dizinde bulunur, bu vault dizininde degil.
4. **Fill architecture.md**: map out existing modules, their roles, data flow.
   **Prepend** the same parent note at the top (after frontmatter).
5. **Fill tasks.md**: if there's a TODO list or issue tracker, pull from it
6. **Fill progress.md**: set "First-time project scan completed" as first entry
7. **Fill roadmap.md**: if there's a roadmap doc or milestones, extract them
8. **Fill changelog.md**: add `v0.0.0` entry with "Initial project scan"
9. **Create `memory/` directory** if it does not exist

After bootstrap, resume the normal workflow.

## During work — what to write

### ALWAYS write to memory when:
- New file or module created
- Function/API signature changed
- Bug fixed (what was the bug, how was it fixed)
- New dependency added or removed
- Config or env var changed
- User made a choice between 2+ approaches → log in decisions.md
- A task was completed → check it off in tasks.md
- A milestone or version was reached → add entry to changelog.md with date
- New feature idea surfaced → add to roadmap.md future phases or ideas section
- Scope change → update product.md (especially "Out of Scope")

### CRITICAL — Always check product.md "Out of Scope" before suggesting features
If the user asks for something listed as Out of Scope, remind them and ask
if they want to move it into scope first. Never build scope-creep features silently.

### NEVER write (this is noise):
- Whitespace or formatting fixes
- Renaming a variable within a single file
- Adding comments
- Small refactors that don't change behavior
- Lint/type fixes
- Anything the user wouldn't need to know 2 weeks from now

**Rule of thumb**: If you'd mention it in a commit message, write it. If not, skip it.

## Progressive Session Log (during session — AUTOMATIC)

While working, append to `[MEMORY_FOLDER]/memory/session-YYYY-MM-DD.md`
**after every significant interaction**. This is NOT the end-of-session
summary — it's a live, incremental log. The user does NOT need to trigger it.

### When to append (automatic)
Append after:
- A task was completed (both success and failure)
- A bug was found or fixed
- A decision was made between 2+ options
- A file was created, deleted, or significantly changed
- User changed direction or gave new instructions
- A milestone was reached
- User feedback was received (positive or negative)

### Format (append, do NOT overwrite)
```markdown
## [HH:MM] [ne yapildi]
- [1 satir — ne oldu, neden, sonuc]
```

### Non-negotiable
- Append only. Never overwrite the file.
- One line per event. Keep it brief.
- Write IMMEDIATELY after the event, don't batch.
- If `memory/` directory does not exist, create it first.
- Do NOT announce each append to the user (too noisy).

### At session END
After writing the daily summary (see next section), append `## END` to the
session log file and stop logging.

## Daily Session Notes (end of every session)

At the end of every session or significant conversation, write a brief
session note to `[MEMORY_FOLDER]/memory/YYYY-MM-DD.md`:

### Format

```markdown
---
tags: [session]
date: YYYY-MM-DD
---

# Session: YYYY-MM-DD

## Konular
- [1-2 sentences about what was discussed]
- [Key decisions made]

## Dosya Degisiklikleri
- `file1.md` → [what changed]
- `file2.js` → [what changed]
```

### What to include
- **User asked** — what the user wanted (1 sentence)
- **What was done** — actions taken (1 sentence)
- **Key decisions** — any choices made between alternatives
- **File changes** — only significant files touched (3-5 max)
- **Next?** — what was left open or planned for next session

### What NOT to include
- Full conversation transcript
- Tool call logs
- Lint/type fixes
- Minor edits
- Internal reasoning

### Non-negotiable
- Write the session note BEFORE ending the session
- Announce it: `memory/YYYY-MM-DD.md guncellendi: [1 cumle ozet]`
- If `memory/` directory does not exist, create it first

## Retention / TTL (auto-cleanup)

Periodically (every 7-10 sessions, or when explicitly asked with "temizlik"
or "cleanup"), check and maintain the vault:

### Daily notes cleanup
1. List all files in `[MEMORY_FOLDER]/memory/` matching `YYYY-MM-DD.md`
2. Files older than **30 days** → move to `[MEMORY_FOLDER]/memory/archive/`
3. Create `memory/archive/` if it does not exist
4. Keep files in `memory/archive/` for 90 more days, then delete (optional)

### Exempt from cleanup
- `MEMORY.md` (if exists) — curated long-term memory
- `USER.md` (if exists) — user profile
- All root vault files (`progress.md`, `tasks.md`, `architecture.md`, etc.)
- Files in directories starting with `.` (like `.obsidian/`)

### Announce the cleanup
> memory/ temizlendi: [N] dosya archive/ altina tasindi, [N] dosya silindi

### What to clean
- Only `memory/*.md` daily notes
- Never touch root vault files or archive unless explicitly asked

## Dream Consolidation (weekly)

When the user says "konsolide et", "ozetle", "consolidate", "dream",
or once per week when you notice many daily notes have accumulated:

### Phase 1: Scan
1. Read all daily notes from `memory/*.md` from the **past 7 days**
2. Also read the current `decisions.md` and `progress.md`
3. Extract recurring themes, key decisions, patterns

### Phase 2: Update decisions.md
If the daily notes contain decisions NOT already in `decisions.md`:
- Append new entries to `decisions.md` with date and context
- Format: `- YYYY-MM-DD: [decision] — [why]`

### Phase 3: Update progress.md
- Review "Son Yapilanlar" — merge relevant items from daily notes
- Update "Son Durum" if the project state changed
- Update "Sonraki Adimlar" if priorities shifted

### Phase 4: Announce
> Dream consolidation tamamlandi. decisions.md: [+N karar], progress.md: [guncellendi]

### Manual consolidation
If the user explicitly triggers consolidation with a topic (e.g. "son
haftayi ozetle"), follow the same flow but execute immediately.

### Safety
- Never delete or overwrite existing entries — only append
- If unsure about a decision's importance, include it
- Progress.md timestamps must be preserved

## Git safety net — prevent breaking working code

Before making any change that touches multiple files or changes core logic,
**remind the user to checkpoint**:

> Take a git checkpoint first:
> ```
> git add -A; git commit -m "checkpoint"
> ```

If a change breaks something that was working before, tell the user:

> Something broke. Roll back with:
> ```
> git reset --hard HEAD
> ```

Then re-read the memory vault to see the last known-good state and try
a different approach.

Do NOT run git commands yourself — only remind the user. The user controls
when to checkpoint and when to roll back.

## File format

All files are plain Markdown with optional YAML frontmatter. They are
designed to be opened as an Obsidian vault. Tags in frontmatter enable
Obsidian graph view and search.

## Why this exists

Different AI tools (Gemini Codex, Claude, GPT, Copilot) cannot see each
other's context. This vault is the shared brain. Every model reads from
and writes to the same files, creating continuity across tools and sessions.

The user can also open this folder as an Obsidian vault to manually browse
project state, link notes, and use Obsidian plugins.
