# Review Checklist

- The selected flows match the requested scope and do not imply full repository coverage unless evidence supports it.
- Every node, edge, and flow step references evidence IDs.
- Evidence records include `kind`, `path`, `provenance`, and `reason`.
- Node and edge IDs are stable and readable.
- Flow steps are ordered and reference existing nodes.
- Edges reference existing source and target nodes.
- Confidence values are valid and low-confidence items explain uncertainty.
- Diagnostics capture gaps, unsupported claims, stale evidence, and required human review.
- Secret-bearing files, raw environment values, credentials, and unnecessary private snippets are absent.
- HTML was generated from validated JSON and is not the canonical source.
