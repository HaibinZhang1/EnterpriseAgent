# Repository Guidelines

## Project Structure & Module Organization
This repository is currently a documentation-first baseline for Enterprise Agent Hub. Keep project docs under `docs/`:

- `docs/RequirementDocument/` — numbered product requirements and acceptance criteria.
- `docs/DetailedDesign/` — architecture, API contracts, data models, deployment, and test strategy.
- `docs/DevelopmentTasks/` — staged implementation checklists (`M1`-`M8`) and agent working rules.
- `docs/UIDesign/` — frontend layout prototype notes.

When application code is introduced, align it with `docs/DetailedDesign/23_technical_architecture.md`: Spring Boot 3 + Java 21 for the server, Electron + React for the Windows desktop client, and React for the admin web UI.

## Frontend Design Guidelines
When developing or modifying client, desktop, or admin frontend code, read `docs/UIDesign/Design.md` first and follow its Glassmorphism visual style. Treat that document as the source of truth for visual direction, color tokens, glass surfaces, backgrounds, spacing rhythm, interaction states, and readability constraints unless the user explicitly provides a newer design direction.

## Agent Execution Principles

These rules adapt the core ideas from `multica-ai/andrej-karpathy-skills`: reduce hidden assumptions, avoid unnecessary complexity, keep diffs surgical, and make completion verifiable.

- Think before coding: state important assumptions, surface tradeoffs, and ask only when ambiguity cannot be resolved safely from repository context. If a simpler approach is available, prefer it or explain why it is insufficient.
- Simplicity first: implement the minimum code that satisfies the request. Do not add speculative features, one-off abstractions, unrequested configurability, or defensive handling for impossible states.
- Surgical changes: touch only files and lines required by the task. Match existing style even when a different style is tempting. Clean up unused code created by your own changes, but only mention unrelated dead code instead of deleting it.
- Goal-driven execution: translate work into explicit success criteria and verification steps. For bugs, prefer a reproducing test before the fix. For refactors, verify behavior before and after. For multi-step tasks, keep a short plan where each step has a check.
- Diff discipline: every changed line should trace directly to the user's request, a requirement document update, or a verification-driven cleanup caused by the change.
- Tradeoff: these principles bias toward caution for non-trivial work. For obvious one-line fixes, use judgment and keep the process lightweight.

## Build, Test, and Development Commands
No build system is committed yet. For documentation changes, run:

```sh
git diff --check
python3 -m json.tool docs/DetailedDesign/MANIFEST.json >/dev/null
python3 -m json.tool docs/DevelopmentTasks/MANIFEST.json >/dev/null
```

Use `git diff --check` to catch whitespace issues, and validate JSON manifests after editing file indexes or checksums. Once code exists, add the real build/test commands here rather than relying on ad hoc scripts.

## Coding Style & Naming Conventions
Markdown files use ATX headings, short paragraphs, and numbered prefixes for ordered design documents (for example, `15_测试策略与开发切片.md`). Keep paths and identifiers in backticks. Preserve existing Chinese terminology unless a document is intentionally translated. Avoid committing `.DS_Store`, `.omx/`, secrets, generated packages, or local runtime files.

## Testing Guidelines
For documentation-only changes, verify links, headings, checklist state, and JSON validity. Do not mark any checklist item complete unless the related change was made and its verification command passed. Future implementation should follow `docs/DetailedDesign/15_测试策略与开发切片.md`: unit, integration, contract, end-to-end, security, and deployment tests.

## Commit & Pull Request Guidelines
Git history currently uses concise imperative summaries, such as `Publish EnterpriseAgent documentation baseline`; development task docs also recommend scoped conventional commits like `feat(server): initialize Spring Boot foundation`. Prefer one stage or focused change per branch/PR, link related checklist items, include a short summary, verification commands, results, screenshots for UI changes, and known risks or gaps.

## Agent-Specific Instructions
Before implementing any stage, read `docs/DevelopmentTasks/00_MASTER_STAGE_CHECKLIST.md`, the relevant `M*` checklist, and `docs/DevelopmentTasks/09_AGENT_WORKING_RULES.md`. Implement tests before features, update checklist evidence, and never use TODO placeholders as completed work.
