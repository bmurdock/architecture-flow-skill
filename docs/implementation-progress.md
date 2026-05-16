# Implementation Progress Log

## 2026-05-14

### Baseline Evaluation

- Baseline branch: `implement-architecture-flows-skill`.
- Current scope source: `docs/implementation-plan.md`.
- Baseline verification: `npm test` passed with 6 validator tests.
- Subagent cleanup: two stale repository-rooted Codex stdio child processes were terminated before implementation continued.

### Phase Status

- Phase 0: Complete. Plan records decisions for fixture, naming, output paths, synthesis mode, evidence strategy, and privacy posture.
- Phase 1: Complete for MVP. Skill skeleton, schema, validator, references, fixtures, and validator tests exist.
- Phase 2: Complete for MVP. Local scanner, normalizer, and secret checker capture git metadata, manifests, JS/TS imports, entrypoints, symbols, stable IDs, provenance, and redactions.
- Phase 3: Complete for MVP. `verify-flows.mjs` checks evidence-backed claims, broken references, unsupported/overclaimed claims, confidence thresholds, stale evidence, and human-review warnings.
- Phase 4: Complete for MVP. `render-viewer.mjs` validates JSON before rendering a self-contained HTML viewer with embedded JSON, flow selection, highlighting, and evidence/confidence/diagnostics panels.
- Phase 5: Complete for MVP. Golden workflow tests, viewer smoke coverage, prompt guardrail checks, low-confidence review checklist coverage, and GitHub Actions artifact upload are in place.
- Phase 6: Complete for MVP. `plan-incremental.mjs` supports `full`, `delta`, and `verify-only` modes, computes next metadata and hashes, detects dirty and committed changes, reports impacted subgraphs, and handles curated field preservation/rejection.

### Verification Added

- Validator tests cover schema, semantic references, required fields, and invalid confidence values.
- Evidence extraction tests cover scanning, normalization, stable IDs, path collisions, comment/string masking, secret redaction, and the `scryfall-mcp` fixture when available.
- Verifier tests cover unsupported claims, broken references, confidence thresholds, stale evidence, and verifier false-positive regressions.
- Renderer tests cover validation-before-rendering, embedded JSON escaping, stale-output cleanup, and direct/symlink/hard-link input protection.
- Golden workflow tests cover validation, verification, rendering smoke output, review checklist language, and synthesis instruction guardrails.
- Incremental tests cover stable plans, changed evidence impact, verify-only mode, missing metadata diagnostics, committed changes since artifact source commit, and schema mode support.

### Current Status

- All phases in `docs/implementation-plan.md` are implemented for the first MVP milestone.
- Remaining work is future hardening beyond the MVP: broader language extraction, richer renderer UX, real generated artifacts for target repositories, and API orchestration if later approved.

## 2026-05-16

### Hardening Update

- Current branch: `architecture-flow-hardening`.
- Scope source: `docs/superpowers/plans/2026-05-16-architecture-flow-hardening.md`.
- Added optional `facts` and `derivedFrom` provenance fields to the schema and semantic validator.
- Added strict verifier mode for fact provenance, repository context, current `sha256:` evidence hashes, and stricter warning promotion.
- Added parser-backed JS/TS fact extraction with `ts-morph` while preserving the existing regex imports and symbols for compatibility.
- Added file content hashes for candidate evidence files and normalized fact-to-evidence links.
- Added a strict golden fixture and CI checks that patch the fixture commit to the current checkout before strict verification.
- Updated scratch handling so root `/tmp/` is ignored while nested source paths such as `src/tmp` remain visible to scans and git.

### Current Status

- The MVP is now hardened for JS/TS evidence quality and strict claim provenance.
- Remaining future work is broader non-JS/TS language extraction, richer renderer UX, real generated artifacts for target repositories, and API orchestration if later approved.
