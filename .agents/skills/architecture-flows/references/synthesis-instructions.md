# Synthesis Instructions

Create `architecture-flows.json` from local evidence only.

## Rules

- Do not invent nodes, edges, steps, data stores, external APIs, or runtime behavior.
- Prefer explicit evidence over inferred relationships.
- Use `low` confidence with `uncertaintyReason` when evidence is indirect or incomplete.
- Put unsupported possibilities in diagnostics instead of normal graph items.
- Reuse evidence IDs across nodes, edges, and flow steps.
- Keep snippets and explanations minimal. Do not include secrets or raw private data.
- Generate only schema-conformant JSON. Do not include markdown fences in the JSON artifact.

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
