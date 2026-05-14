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
3. Scan deterministic evidence before synthesizing architecture claims.
4. Synthesize JSON from evidence only, using `references/synthesis-instructions.md`.
5. Validate the JSON with `scripts/validate-flows.mjs`.
6. Repair unsupported claims, broken references, invalid confidence values, or missing evidence.
7. Generate the HTML viewer only after JSON validation passes.
8. Review against `references/review-checklist.md` before calling the work complete.

## Safety Rules

- Treat `architecture-flows.json` as the source of truth; never hand-edit HTML as canonical architecture data.
- Every node, edge, and flow step must reference reusable evidence.
- Low-confidence items require an uncertainty reason.
- Unsupported claims belong in diagnostics or gaps, not normal nodes, edges, or steps.
- Prefer symbols and stable IDs over brittle line numbers. Line ranges are optional.
- Exclude or redact secrets, credentials, raw environment values, and unnecessary private data.

## Definition of Done

- JSON validates against the schema and semantic checks.
- The artifact has no broken node, edge, flow, or evidence references.
- Evidence and confidence are visible for meaningful claims.
- Diagnostics explain gaps, uncertainty, and review needs.
- The generated viewer can be opened locally without network access.
