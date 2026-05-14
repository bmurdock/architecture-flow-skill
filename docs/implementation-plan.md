# Implementation Plan

## Current Scope

This repository is a planning workspace for a future Codex skill named `architecture-flows` or `architecture-flow-map`. The first milestone should prove the data model, validation rules, and viewer workflow before adding broad extractor coverage or CI automation.

## Assumptions

- The skill will be repo-local at first, under `.agents/skills/architecture-flows/`.
- Generated artifacts will be written to `docs/architecture/` in the target repository.
- JSON will be the source of truth; HTML will render from JSON.
- Node.js will be the default scripting runtime.
- The first extractor target will be JavaScript/TypeScript unless a different fixture repo is chosen.
- Model-assisted synthesis will be evidence-bounded and must preserve uncertainty.

## Phase 0: Design Lock

Goal: turn the research into decisions that can drive implementation.

Tasks:

- Choose the first fixture repository.
- Pick the skill name and output paths.
- Decide whether the first viewer embeds JSON or reads a sidecar file.
- Decide whether MVP synthesis is Codex-in-session only or uses an explicit Responses API script.
- Decide the first supported language ecosystem.

Success criteria:

- Open decisions are resolved or explicitly deferred.
- The MVP has a narrow acceptance target.
- No implementation work depends on unresolved architecture choices.

## Phase 1: Skill Skeleton and Contract

Goal: create the repo-local skill package and the architecture-flow JSON contract.

Proposed files:

```text
.agents/skills/architecture-flows/
  SKILL.md
  references/
    confidence-rubric.md
    review-checklist.md
    schema-notes.md
  scripts/
    validate-flows.mjs
  assets/
    viewer-template.html

docs/architecture/
  architecture-flow.schema.json
```

Tasks:

- Draft `SKILL.md` with trigger conditions, workflow, safety rules, outputs, and definition of done.
- Write `architecture-flow.schema.json`.
- Implement `validate-flows.mjs` for schema validation and basic semantic checks.
- Add tiny valid and invalid fixture JSON files.

Success criteria:

- Valid fixture passes.
- Invalid fixtures fail for missing required fields, broken references, and invalid confidence values.
- `SKILL.md` is concise enough to be useful as a real Codex skill, not a research essay.

## Phase 2: Local Evidence Extraction MVP

Goal: produce normalized evidence without model inference.

Tasks:

- Add a scanner that captures git metadata, file tree, package manifests, and candidate source/test/config files.
- Add JS/TS seed extraction for imports and obvious entrypoints.
- Normalize evidence into a compact evidence bundle.
- Avoid secret-bearing files and redact suspicious snippets.

Proposed scripts:

```text
.agents/skills/architecture-flows/scripts/scan-repo.mjs
.agents/skills/architecture-flows/scripts/normalize-evidence.mjs
.agents/skills/architecture-flows/scripts/check-secrets.mjs
```

Success criteria:

- Scanner runs on the fixture repo without external services.
- Evidence bundle includes stable IDs, paths, symbols where available, and provenance.
- Secret-like values are excluded or redacted.

## Phase 3: Flow Synthesis and Verification

Goal: turn evidence into candidate flow JSON while preventing unsupported claims.

Tasks:

- Write generation instructions that require schema-conformant, evidence-backed output.
- Add verifier instructions or a verifier script that checks unsupported claims, broken references, overclaiming, and stale evidence.
- Add confidence threshold behavior.
- Document when human review is required.

Implementation options:

- MVP option: Codex uses the skill instructions and local evidence bundle to produce `architecture-flows.json`.
- Later option: a `generate-flows.mjs` script calls the Responses API with Structured Outputs and `store: false` where appropriate.

Success criteria:

- Every node, edge, and flow step references evidence.
- Low-confidence or inferred relationships are marked as such.
- Unsupported claims are removed, downgraded, or surfaced as diagnostics.

## Phase 4: Static HTML Viewer

Goal: render validated JSON into a readable local HTML artifact.

Tasks:

- Build a self-contained viewer template.
- Render nodes and edges grouped by package, layer, or domain.
- Add workflow selection and graph highlighting.
- Add step, evidence, confidence, and diagnostics panels.
- Keep the viewer independent from the JSON contract.

Success criteria:

- `architecture-flows.html` opens locally.
- Selecting a flow highlights the expected nodes and edges.
- Evidence and confidence are visible for selected graph items.
- Viewer generation fails clearly if JSON validation fails.

## Phase 5: Tests, Evals, and CI

Goal: make regeneration reviewable and resistant to drift.

Tasks:

- Add unit tests for validators and ID stability.
- Add golden fixtures for one or two small repositories.
- Add viewer smoke tests.
- Add a human review checklist for low-confidence deltas.
- Add a GitHub Actions workflow after the local workflow is stable.

Success criteria:

- Schema and semantic validation run in CI.
- Golden fixtures catch accidental prompt, schema, and renderer regressions.
- PR artifacts are reviewable without publishing private architecture externally.

## Phase 6: Incremental Generation

Goal: avoid noisy full regeneration after every change.

Tasks:

- Store commit SHA, parent artifact hash, schema version, and extractor versions in metadata.
- Detect changed files and impacted subgraphs.
- Support `full`, `delta`, and `verify-only` modes.
- Preserve or explicitly reject human-curated fields during regeneration.

Success criteria:

- Re-running on the same commit is stable.
- Diffs are small when only a narrow workflow changes.
- Tool upgrades can trigger regeneration even when source files did not change.

## First Useful MVP

The smallest useful version should include:

- `SKILL.md`
- `architecture-flow.schema.json`
- a validator script
- a local evidence scanner for one language ecosystem
- one fixture repo output
- a static HTML viewer
- a review checklist

This MVP should not include multi-language support, hosted orchestration, rich editing in the viewer, or automatic publishing.

## Review Questions

Before implementation starts, review these choices:

1. Should the first fixture be `scryfall-mcp` for accuracy or `Planeview` for portfolio payoff?
2. Should the first generated HTML embed JSON for portability or load `architecture-flows.json` as a sidecar?
3. Should the first skill depend on Codex-session synthesis, or should it include explicit API orchestration from day one?
4. Should the schema optimize first for line-level evidence or symbol-level evidence with optional line numbers?
5. What privacy posture should be the default for private repositories?

## User-supplied answers to review questions
1. The first fixture should be 'scryfall-mcp` for accuracy.
2. Write canonical sidecar JSON, but generate first HTML with embedded JSON snapshot.
3. Start with Codex-session synthesis. See note below.
4. Optimize for symbol-level evidence with optional line ranges.
5. Default to local-only, minimal-evidence, no raw repo upload, no publishing.

---

# 3. Codex-session synthesis or explicit API orchestration?

For the first skill: **Codex-session synthesis**.

Do not start with a `generate-flows.mjs` script that calls the Responses API. The implementation plan already describes the right split: MVP can have Codex use the skill instructions and local evidence bundle to produce `architecture-flows.json`, while a later option can call the Responses API with Structured Outputs and `store: false`. 

The first milestone should prove:

* The schema is good.
* The evidence bundle is useful.
* The validator catches bad output.
* The viewer can render the artifact.
* The review checklist catches overclaiming.

Explicit API orchestration adds complexity before you know whether the contract is right.

I would still prepare for later API orchestration by adding one reference file now:

```text
.agents/skills/architecture-flows/references/synthesis-instructions.md
```

That file can contain the exact synthesis rules Codex should follow. Later, `generate-flows.mjs` can reuse or adapt those instructions for API-based Structured Outputs.

So the MVP workflow should be:

```text
scan repo → normalize evidence → Codex synthesizes JSON → validate → repair if needed → render HTML
```

Not:

```text
build scanner → build API client → build structured-output orchestration → debug model pipeline → then discover the schema is wrong
```

The second path is tempting, but it optimizes the wrong thing too early.

---

---

# 4. Line-level evidence or symbol-level evidence?

Use **symbol-level evidence first, with optional line numbers**.

Line numbers are useful, but brittle. They drift constantly. If the schema requires line-level precision everywhere, you will make the MVP harder to implement, harder to regenerate, and noisier to diff.

The research synthesis says evidence should be first-class and reusable, with nodes, edges, and steps referencing evidence IDs rather than embedding loose explanatory strings. It also recommends collecting paths, symbols, route/controller/service/test symbols where available, and provenance. 

I would define evidence records like this:

```json
{
  "id": "ev:src/tools/card-search.ts#searchCards",
  "kind": "symbol",
  "path": "src/tools/card-search.ts",
  "symbol": "searchCards",
  "language": "typescript",
  "provenance": "typescript-ast",
  "reason": "Defines the MCP tool handler for card search.",
  "location": {
    "startLine": 42,
    "endLine": 88
  },
  "contentHash": "sha256:..."
}
```

Make `path`, `kind`, `provenance`, and `reason` required. Make `symbol`, `startLine`, `endLine`, and `contentHash` optional at first.

Then enforce stronger rules by confidence level:

```text
high confidence:
  requires direct evidence with path + symbol or path + static relation

medium confidence:
  requires evidence but may be inferred from naming, tests, route registration, or nearby calls

low confidence:
  requires evidence plus an explicit uncertainty reason

unsupported:
  cannot appear as a normal node/edge/step; must go into diagnostics or gaps
```

This gives you room to support config files, package manifests, dynamic registration, and generated behavior without pretending everything has a clean symbol and line span.

---

# Two tweaks I would make to the implementation plan

## 1. Put the schema inside the skill, then copy it to generated docs

Right now the proposed skeleton puts `schema-notes.md` under `references/` but puts the schema under `docs/architecture/`. 

I would make the skill’s schema canonical:

```text
.agents/skills/architecture-flows/
  references/
    architecture-flows.schema.json
    confidence-rubric.md
    review-checklist.md
    schema-notes.md
```

Then generation can copy the schema into the target repo output:

```text
docs/architecture/
  architecture-flows.schema.json
  architecture-flows.json
  architecture-flows.html
```

That makes the skill self-contained while keeping generated artifacts reviewable.

## 2. Use plural naming consistently

I would standardize on:

```text
architecture-flows
architecture-flows.schema.json
architecture-flows.json
architecture-flows.html
```

Your plan currently uses both `architecture-flow.schema.json` and `architecture-flows.json`. That is minor, but these tiny inconsistencies become annoying once scripts, docs, and fixtures start depending on them.

---

# Suggested Phase 0 decision block

This is what I would add to the implementation plan:

```md
## Phase 0 Decisions

- Skill name: `architecture-flows`
- Skill location: `.agents/skills/architecture-flows/`
- Generated artifact location: `docs/architecture/`
- Canonical generated data: `docs/architecture/architecture-flows.json`
- Schema name: `architecture-flows.schema.json`
- First fixture: `scryfall-mcp`
- Second fixture: `Planeview`
- First language ecosystem: JavaScript/TypeScript
- Runtime: Node.js
- First synthesis mode: Codex-session synthesis using local evidence bundle
- Later synthesis mode: optional Responses API script using Structured Outputs
- Viewer mode: single-file HTML with embedded validated JSON snapshot
- JSON source-of-truth rule: HTML is generated from JSON and must never be edited as the canonical architecture artifact
- Evidence strategy: symbol-level evidence with optional line ranges
- Privacy default: local-only for private repositories; redacted evidence bundle only with explicit approval
```

---

# Suggested MVP acceptance target for `scryfall-mcp`

For the first fixture, I would define success very narrowly:

```md
The MVP succeeds on `scryfall-mcp` when:

1. The scanner produces a normalized evidence bundle containing:
   - git metadata
   - package metadata
   - relevant source/config/test files
   - JS/TS import relationships
   - candidate symbols or entrypoints where available

2. Codex produces `docs/architecture/architecture-flows.json` containing:
   - metadata
   - reusable evidence records
   - nodes
   - edges
   - 3–5 named flows
   - diagnostics/gaps
   - confidence values

3. Validation confirms:
   - schema validity
   - no broken node, edge, flow, or evidence references
   - no invalid confidence values
   - every node, edge, and flow step references evidence
   - low-confidence items include reasons

4. The renderer produces `docs/architecture/architecture-flows.html`.

5. The HTML opens locally and allows:
   - selecting a workflow
   - highlighting related nodes and edges
   - reading ordered flow steps
   - inspecting evidence and confidence

6. The output does not include secrets, raw environment values, credentials, or unnecessary private data.
```

That acceptance target keeps the project honest. It proves the architecture instrument works before you ask it to impress anyone.
