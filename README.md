# Architecture Flow Skill

Evidence-backed Codex skill for generating architecture flow maps from real repositories.

The skill keeps `architecture-flows.json` as the source of truth, validates it against a schema, verifies semantic claims against local evidence, and renders a self-contained HTML viewer only after the JSON artifact passes validation.

## What is included

- `.agents/skills/architecture-flows/SKILL.md`: Codex skill workflow and definition of done.
- `.agents/skills/architecture-flows/scripts/scan-repo.mjs`: local repository scanner for manifests, candidate files, imports, symbols, entrypoints, git metadata, and redactions.
- `.agents/skills/architecture-flows/scripts/normalize-evidence.mjs`: deterministic evidence normalization with stable IDs.
- `.agents/skills/architecture-flows/scripts/validate-flows.mjs`: schema and reference validation for architecture flow artifacts.
- `.agents/skills/architecture-flows/scripts/verify-flows.mjs`: semantic checks for evidence quality, overclaims, stale evidence, and confidence rules.
- `.agents/skills/architecture-flows/scripts/plan-incremental.mjs`: regeneration planning for full, delta, and verify-only updates.
- `.agents/skills/architecture-flows/scripts/render-viewer.mjs`: offline HTML viewer generation from validated JSON.
- `test/`: Node test coverage for scanner, normalizer, validator, verifier, renderer, incremental planning, and the golden workflow.

## Basic workflow

1. Scan a target repository locally.
2. Normalize the scan into a compact evidence bundle.
3. Synthesize `architecture-flows.json` from evidence only, following `references/synthesis-instructions.md`.
4. Validate the JSON artifact.
5. Verify evidence-backed semantics, passing `--repo <path>` when the source repository is available.
6. Render the HTML viewer after validation and verification pass.
7. Review the result with `references/review-checklist.md`.

Example commands:

```bash
node .agents/skills/architecture-flows/scripts/scan-repo.mjs /path/to/repo > scan.json
node .agents/skills/architecture-flows/scripts/normalize-evidence.mjs scan.json > evidence.json
node .agents/skills/architecture-flows/scripts/validate-flows.mjs docs/architecture/architecture-flows.json
node .agents/skills/architecture-flows/scripts/verify-flows.mjs --repo /path/to/repo docs/architecture/architecture-flows.json
node .agents/skills/architecture-flows/scripts/render-viewer.mjs docs/architecture/architecture-flows.json docs/architecture/architecture-flows.html
```

## Development

Run the test suite with:

```bash
npm test
```

The repository is intentionally dependency-light and currently uses Node's built-in test runner.

## Safety posture

The skill is local-first. It should not upload raw repository contents or publish generated architecture artifacts without explicit approval. Claims in `architecture-flows.json` must be tied to evidence, confidence, provenance, diagnostics, and uncertainty where appropriate.
