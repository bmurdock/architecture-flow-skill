# Implementation Issue Tracking Log

## 2026-05-14

### Open

- Broader extractor coverage remains future work beyond the first JS/TS MVP.
- The golden fixture intentionally carries a reviewed warning for `metadata.commit` because it is a committed local fixture rather than a real repository artifact.
- Responses API orchestration remains intentionally deferred; current synthesis is Codex-session based.
- Rich hosted publishing and multi-repository artifact publishing remain out of scope for the MVP.

### Closed

- Phase 2 extraction scripts were added: scanner, normalizer, and secret checker.
- Phase 3 verifier was added for evidence-backed semantics, overclaiming, stale evidence, confidence thresholds, and broken references.
- Phase 4 viewer generation was added with validation gating, embedded JSON, flow highlighting, panels, and stale-output safety.
- Phase 5 test, golden fixture, and CI coverage were added, including upload of local review artifacts.
- Phase 6 incremental planning was added with `full`, `delta`, and `verify-only` modes, metadata planning, committed/dirty change detection, impacted subgraphs, and curated field policy.
