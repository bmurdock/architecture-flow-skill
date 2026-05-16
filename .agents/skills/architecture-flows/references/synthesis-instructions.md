# Synthesis Instructions

Create `architecture-flows.json` from local evidence only.

## Rules

- Do not invent nodes, edges, steps, data stores, external APIs, or runtime behavior.
- Prefer explicit evidence over inferred relationships.
- Use `medium` or `low` confidence with `uncertaintyReason` when evidence is indirect, incomplete, or inferred.
- Do not use high confidence with words like `likely`, `assumed`, `inferred`, `probably`, `might`, or `appears`.
- Put unsupported possibilities in diagnostics instead of normal graph items.
- Reuse evidence IDs across nodes, edges, and flow steps.
- Avoid placeholder evidence such as `ev:unknown`, `todo`, `unknown`, or generic manual notes.
- Keep snippets and explanations minimal. Do not include secrets or raw private data.
- Set `metadata.privacy` to `local-only` unless the user explicitly approves a redacted or published artifact.
- Set `metadata.generationMode` to the synthesis mechanism and `metadata.incrementalMode` to `full`, `delta`, or `verify-only`.
- Carry `metadata.schemaVersion`, `metadata.sourceCommit`, `metadata.extractorVersions`, and `metadata.parentArtifactHash` from the incremental plan when regenerating.
- Set `metadata.parentArtifactHash` to the plan's `parentArtifactHashForNext`. Do not copy `currentArtifactHash` into `metadata.artifactHash`; compute the regenerated artifact's final `metadata.artifactHash` only after the regenerated content is finalized.
- Treat `missing-incremental-metadata` planner diagnostics as a regeneration metadata issue: new artifacts should copy the complete `nextMetadata` values even though the schema still accepts legacy artifacts without them.
- Treat `unmappedChangedFiles` as a discovery requirement. The existing artifact has no evidence references for those source or config paths, so a delta plan cannot safely claim no graph impact until evidence extraction or synthesis has considered them.
- Preserve only curated fields listed under `curatedFields.preserve` in the incremental plan. Do not silently keep fields listed under `curatedFields.reject`; either remove them or stop for explicit human handling.
- Generate only schema-conformant JSON. Do not include markdown fences in the JSON artifact.

## Verification

Run both checks before generating the viewer:

```bash
node .agents/skills/architecture-flows/scripts/validate-flows.mjs docs/architecture/architecture-flows.json
node .agents/skills/architecture-flows/scripts/verify-flows.mjs --repo <source-repo> docs/architecture/architecture-flows.json
node .agents/skills/architecture-flows/scripts/verify-flows.mjs --strict --repo <source-repo> docs/architecture/architecture-flows.json
```

If repository context is unavailable, run `verify-flows.mjs` without `--repo` and keep the warning in review notes. Blocking verifier errors require removing the claim, downgrading confidence with `uncertaintyReason`, replacing placeholder evidence, resolving diagnostics with `error` severity, or regenerating evidence from the current repository state.

## Strict Mode

Use strict mode before rendering when repository context is available.

- Every node, edge, and flow step must include `derivedFrom`.
- Every `derivedFrom` value must reference a deterministic fact ID.
- Every fact must reference evidence.
- Every evidence record used by facts must include a `sha256:` content hash when repository context is available.
- Run `verify-flows.mjs --strict --repo <source-repo>` before rendering.
- If strict verification fails, remove the claim, regenerate facts, downgrade the claim into diagnostics, or stop for human review.

For incremental work, run a plan first:

```bash
node .agents/skills/architecture-flows/scripts/plan-incremental.mjs --repo <source-repo> --artifact docs/architecture/architecture-flows.json --mode delta
node .agents/skills/architecture-flows/scripts/plan-incremental.mjs --repo <source-repo> --artifact docs/architecture/architecture-flows.json --mode verify-only
```

Use `full` when the whole artifact should be regenerated, `delta` when only impacted subgraphs should be considered, and `verify-only` when checking the current artifact without writing a plan file unless `--output` is provided. The planner combines dirty working-tree changes with committed file changes from the artifact source commit to current `HEAD`, so an artifact generated on an older commit can still produce a narrow impacted-subgraph plan after later commits. If the plan includes `unmapped-source-changed`, run discovery for those paths before treating the delta as narrow.

Human review is required when verifier warnings remain, when a flow depends on inferred framework behavior, when repository context was unavailable for stale evidence checks, or when diagnostics describe incomplete coverage.

## Expected Shape

The artifact must include:

- `schemaVersion`
- `metadata`
- `evidence`
- `nodes`
- `edges`
- `flows`
- `diagnostics`

Each flow should represent a useful workflow slice, not a whole-repository import graph.
