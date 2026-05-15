# Schema Notes

The canonical schema is `references/architecture-flows.schema.json`. Generated repositories should receive a copied schema at `docs/architecture/architecture-flows.schema.json` for reviewability.

The contract favors symbol-level evidence with optional line ranges. Line numbers are useful for inspection but should not be required for every claim because they drift frequently.

Evidence records are reusable and first-class. Nodes, edges, diagnostics, and flow steps reference evidence by ID instead of embedding loose source explanations.

Incremental generation metadata remains optional in the JSON Schema for backwards compatibility with existing fixtures and artifacts. For `full`, `delta`, and `verify-only` planning, `plan-incremental.mjs` reports warning diagnostics when artifacts are missing these Phase 6 fields, and emits replacement values under `nextMetadata`:

- `metadata.schemaVersion`: schema version used by the generator.
- `metadata.sourceCommit`: source repository commit used for evidence.
- `metadata.extractorVersions`: deterministic versions or hashes for local extractor/planner scripts.
- `metadata.artifactHash`: canonical hash of the finalized artifact content, excluding volatile hash metadata. Regenerated artifacts compute this after content is finalized.
- `metadata.parentArtifactHash`: prior artifact hash when regenerating from an earlier artifact. The planner reports this as `parentArtifactHashForNext`, using the current input artifact hash.
- `metadata.incrementalMode`: one of `full`, `delta`, or `verify-only`.

Use `metadata.generationMode` for the synthesis mechanism (`codex-session`, `api-structured-output`, or `manual`) and `metadata.incrementalMode` for the regeneration strategy. The plan reports `currentArtifactHash` separately from `nextMetadata` because the next artifact's final `metadata.artifactHash` is not knowable until regeneration is complete.

The validator performs semantic checks that JSON Schema alone cannot express cleanly:

- duplicate IDs
- broken evidence references
- broken node references
- invalid confidence values
- low-confidence normal items without uncertainty reasons
- unsupported normal items

`plan-incremental.mjs` computes local planning metadata without model regeneration. It compares evidence paths and content hashes against a repository, combines dirty `git status` paths with committed changes from `metadata.sourceCommit` or `metadata.commit` to current `HEAD`, reports impacted evidence, nodes, edges, flows, and steps, detects relevant changed files that are not represented by existing evidence as `unmappedChangedFiles`, detects extractor version changes, and lists curated fields that can be preserved or must be rejected.
