# Professional Gates

This project now includes a stricter operational layer for the opencode agency
agents. The goal is to make the team behave less like a loose prompt set and
more like a professional delivery pipeline.

## Added Skill

`.opencode/skill/ajans-quality-gates/SKILL.md`

This skill adds:

- Definition of Ready before strategy starts
- Stage gates between agency phases
- Acceptance criteria tracking
- Build verification rules
- Review and fix loops
- Final delivery checklist
- Change request control
- Evidence standards for data, SEO, architecture, and QA claims

## Agent Updates

The following agents now reference the quality-gate rules directly:

- `takim-lideri`: owns gates, approval, review loops, final checklist, and scope control
- `creative-director`: links creative decisions to target audience and acceptance criteria
- `veri-analisti`: separates sourced evidence from assumptions
- `ux-tasarimci`: adds edge states, accessibility, and testable user flows
- `seo-uzmani`: blocks delivery for critical SEO issues
- `icerik-editoru`: blocks delivery for missing or placeholder copy
- `yazilim-uzmani`: classifies QA findings as Critical, Major, or Minor
- `yazilim-muhendisi`: records acceptance status, verification commands, smoke tests, and fix notes

## Expected Delivery Behavior

A normal brief should now move through this stricter path:

1. Baris confirms the brief is ready.
2. Specialists produce strategy, UX, SEO, architecture, and copy outputs.
3. Baris asks for explicit approval before build.
4. Mert builds and records verification evidence.
5. Review agents classify issues.
6. Critical issues trigger a fix loop instead of final delivery.
7. Baris creates `ai-memory/review/final-checklist.md`.
8. Final delivery includes changed files, run instructions, verification results,
   known gaps, and acceptance-criteria status.

## What This Improves

- Less silent scope drift
- Fewer unverified builds
- Clearer handoff between strategy, build, and review
- More professional evidence standards
- Better final delivery reports
- A defined path when review finds critical problems
