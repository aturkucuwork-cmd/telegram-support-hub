---
name: ajans-quality-gates
description: Use with ajans-workflow when the opencode agency system is active. Adds professional delivery controls: definition of ready, stage gates, acceptance criteria, build verification, review loops, scope control, and final delivery checklist.
---

# Ajans Quality Gates

This skill turns the agency workflow into a stricter professional delivery
pipeline. It does not replace `ajans-workflow`; it adds operational gates that
must be checked before moving between stages.

## Definition of Ready

Before strategy starts, `ai-memory/brief.md` must include:

- **Goal**: What the user wants and what success looks like.
- **Scope**: Pages, features, deliverables, and platforms included in this run.
- **Out of scope**: Things explicitly not included.
- **Audience**: Who the work is for.
- **Delivery format**: Website, app, copy, prototype, document, etc.
- **Constraints**: Language, brand tone, technology, time, content, legal,
  security, or platform constraints.
- **Acceptance criteria**: 3-7 concrete checks for final delivery.

If a critical item is missing, Baris asks at most 3 targeted questions. If the
brief remains too vague, write `STATUS: BLOCKED` and do not start strategy.

## Stage Gates

Baris checks content quality, not only the final STATUS line.

- **Strategy gate**: `strategy/creative.md` and `strategy/data.md` exist.
  Source-backed claims include links; assumptions are labeled.
- **Design/spec gate**: `spec/ux.md`, `spec/seo.md`, and
  `spec/architecture.md` exist. UX and architecture must define security (OWASP Top 10) and accessibility (WCAG AA/A11y) goals. Spec files do not contain blocking conflicts.
- **Content gate**: `content/copy.md` contains real copy. No lorem ipsum,
  placeholder CTA, empty state, or missing required microcopy remains.
- **Approval gate**: Baris presents scope, approach, content summary, risks,
  and acceptance criteria. Build does not start without explicit user approval.
- **Build gate**: Mert creates or edits real project files and records install,
  build, test, and smoke results in `build/notes.md`. Mert must write unit/integration tests (TDD) for any new logic.
- **Review gate**: QA (including Security & A11y checks), SEO audit, and copy edit are complete. If any critical
  issue exists, delivery stops and a fix loop starts.
- **Delivery gate**: Final report includes changed files, run instructions,
  verification results, known gaps, and acceptance-criteria status.

## Build Verification Rules

Mert runs the strongest reasonable verification for the project type:

### 1. Incremental Implementation
Mert must build and compile/test the codebase slice-by-slice. Do not write the whole codebase before running a build or compilation check. After each successful slice, a local Git checkpoint commit must be created.

### 2. Test-Driven Development (TDD)
Before writing code for new features or bug fixes, a failing unit or integration test must be written or identified. Mert must run the test suite and ensure it fails first, then write the code to make it pass.

### 3. Build & Smoke Checks
- Frontend: lint, typecheck, build, test, or an available equivalent; then a
  basic page smoke check when applicable.
- Backend/API: tests or a basic endpoint smoke check.
- Static HTML: file openability plus basic link and asset checks.
- Document/copy: render/readability check plus placeholder scan.

If a command cannot run, Mert records the reason in `build/notes.md`. A missing
verification is not treated as a successful build.

## Review Loop

If any review file contains critical issues:

1. Baris stops delivery.
2. Baris consolidates critical findings into one fix brief for Mert.
3. Mert fixes the issues and writes `ai-memory/build/fix-notes.md`.
4. Only the affected review agents rerun.
5. Delivery resumes only when no critical issue remains.

The loop may run up to 3 times. If critical issues remain after the third loop,
Baris reports `STATUS: BLOCKED` with the unresolved items.

## Final Checklist

Before final delivery, Baris creates `ai-memory/review/final-checklist.md`:

```markdown
# Final Checklist

- [ ] Brief acceptance criteria met
- [ ] Out-of-scope items preserved
- [ ] Build/test/smoke result recorded
- [ ] TDD and automated test verification completed (failing test first verified)
- [ ] Git checkpoints and atomic commits verified
- [ ] Security (OWASP 10) & Accessibility (A11y/WCAG) checks passed
- [ ] No critical QA issue
- [ ] No critical SEO issue
- [ ] No placeholder or missing copy
- [ ] Run instructions are current
- [ ] Known gaps are explicit

STATUS: READY_FOR_DELIVERY
```

If any item cannot be checked, the checklist ends with `STATUS: BLOCKED` and a
short explanation.

## Change Request Control

If the user changes scope after approval, Baris appends a `Change Request`
entry to `ai-memory/decisions.md`:

- Date
- Requested change
- Affected stages/files
- Risk or timeline impact
- Decision: included now / deferred

Expanded scope does not go directly to build. The relevant spec or content
agents must update their outputs first.

## Evidence Standard

Professional claims require evidence or explicit labeling:

- Market, competitor, data, and SEO claims use source links when possible.
- Unsupported claims are labeled `Assumption:` or `Needs validation:`.
- Architecture decisions include a reason.
- QA findings cite a file, behavior, command result, or acceptance criterion.
