---
name: architecture-flows
description: Generate evidence-backed architecture flow maps for repositories, with JSON as the source of truth and HTML as a generated viewer.
---

# Architecture Flows

Use this skill when a user asks to map, explain, regenerate, validate, or review architecture flows for a repository.

## Outputs

- `docs/architecture/architecture-flows.json`: canonical flow artifact.
- `docs/architecture/architecture-flows.html`: generated local viewer with an embedded snapshot.
- `docs/architecture/architecture-flows.schema.json`: copied schema for review in the target repository.
- Validation diagnostics when the artifact is incomplete, stale, unsupported, or low confidence.

## Workflow

1. Confirm the requested repository and workflow scope.
2. Keep extraction local-first. Do not upload raw repository contents or publish artifacts without explicit approval.
3. Scan deterministic evidence before synthesizing architecture claims; JS/TS scans include parser-backed facts and file hashes.
4. Synthesize JSON from evidence and facts only, using `references/synthesis-instructions.md`.
5. Validate the JSON with `scripts/validate-flows.mjs`.
6. Verify executable semantics with `scripts/verify-flows.mjs`; pass `--repo <path>` when the source repository is available.
7. Use `scripts/verify-flows.mjs --strict --repo <path>` for high-assurance or publishable artifacts so normal claims trace through `derivedFrom` facts and fresh evidence hashes.
8. Repair unsupported claims, broken references, invalid confidence values, stale evidence, missing facts, or missing evidence.
9. For regeneration, run `scripts/plan-incremental.mjs --repo <path> --artifact <architecture-flows.json> --mode <full|delta|verify-only>` before changing the artifact.
10. Generate the HTML viewer only after JSON validation and verification pass.
11. Review against `references/review-checklist.md` before calling the work complete.

## Safety Rules

- Treat `architecture-flows.json` as the source of truth; never hand-edit HTML as canonical architecture data.
- Every node, edge, and flow step must reference reusable evidence.
- In strict mode, every node, edge, and flow step must include `derivedFrom` references to deterministic facts, and facts must reference evidence.
- Low-confidence items require an uncertainty reason.
- Inferred relationships must be downgraded from high confidence and explain uncertainty.
- Unsupported claims belong in diagnostics or gaps, not normal nodes, edges, or steps.
- Prefer symbols and stable IDs over brittle line numbers. Line ranges are optional.
- Exclude or redact secrets, credentials, raw environment values, and unnecessary private data.
- Preserve only curated fields listed by the incremental plan; reject unknown human-curated fields unless they can be explicitly carried forward.

## Definition of Done

- JSON validates against the schema and semantic checks.
- `verify-flows.mjs` reports no blocking errors; warnings are visible and reviewed.
- Strict verification passes when the artifact is intended for high-assurance review, rendering, or publication and repository context is available.
- The artifact has no broken node, edge, flow, or evidence references.
- Strict artifacts have no broken fact references and evidence used by facts has current `sha256:` hashes.
- Evidence and confidence are visible for meaningful claims.
- Diagnostics explain gaps, uncertainty, and review needs.
- The generated viewer can be opened locally without network access.
