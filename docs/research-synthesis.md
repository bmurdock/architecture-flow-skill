# Research Synthesis

## Source Materials

This synthesis is based on:

- `/Users/brianmurdock/Downloads/arch-flow-summary.md`
- `/Users/brianmurdock/Downloads/Architecture Flow Generation Skill for Codex Using GPT-5.5.docx`

The summary supplies conversation context and project intent. The DOCX report supplies the deeper implementation recommendations.

## Core Conclusion

An architecture-flow Codex skill is feasible, but only if it is designed as an evidence pipeline rather than a single prompt that asks a model to draw an application. The durable output should be a schema-validated JSON artifact, with the HTML viewer generated from that JSON.

Recommended pipeline:

1. Deterministic repository extraction.
2. Normalized evidence graph.
3. GPT-5.5 synthesis into architecture-flow JSON.
4. Schema and semantic validation.
5. Verifier pass for unsupported claims and broken references.
6. Human review for low-confidence or high-impact changes.
7. Static HTML rendering from validated JSON.

## Product Definition

The skill should generate an architecture flow map for selected, important workflows in a repository. The map should help two audiences:

- Humans who need to understand how a feature, request, command, build step, or domain workflow moves through the codebase.
- Future Codex sessions that need compact, evidence-backed architecture context before making changes.

The intended artifacts are:

- `architecture-flows.json`: canonical machine-readable architecture data.
- `architecture-flows.html`: local, static viewer generated from the JSON.
- Validation diagnostics: schema errors, broken references, stale evidence, low-confidence items, and documented gaps.

The output should not claim complete coverage unless the repository is small and the evidence supports that claim.

## Skill Shape

The research recommends a repo-local Codex skill such as:

```text
.agents/skills/architecture-flows/
  SKILL.md
  scripts/
  references/
  assets/
  agents/openai.yaml
```

The first implementation should keep `SKILL.md` concise and use progressive disclosure:

- `SKILL.md` defines when to use the skill, required inputs, expected outputs, safety rules, workflow, and completion criteria.
- `references/` holds schema notes, confidence rubric, review checklist, and extractor guidance.
- `scripts/` performs deterministic scanning, validation, rendering, and optional model orchestration.
- `assets/` holds the offline viewer template and bundled browser libraries if needed.

The generated architecture artifacts should usually live outside the skill, for example:

```text
docs/architecture/
  architecture-flow.schema.json
  architecture-flows.json
  architecture-flows.html
```

## Data Contract

The JSON contract should be treated as a stable internal API. It should use JSON Schema Draft 2020-12 and include at least:

- `metadata`: repo, branch, commit, generation mode, generator/verifier models, tool versions, warnings.
- `nodes`: packages, modules, routes, functions, services, queues, databases, external APIs, tests.
- `edges`: imports, calls, routes-to, reads, writes, persists-to, emits, consumes, configures.
- `flows`: named workflows with triggers, ordered steps, entry and exit references.
- `evidence`: reusable evidence records referenced by nodes, edges, and flow steps.
- `diagnostics`: quality and review signals.

Evidence should be first-class and reusable. Nodes, edges, and flow steps should reference evidence by ID rather than embedding loose explanatory strings.

Confidence should be explicit. A useful confidence model includes overall confidence plus dimensions such as existence, direction, semantics, and completeness. Low confidence should require reasons.

## Extraction Strategy

The MVP should be local-first and language-aware. The first extractors should collect cheap, stable facts:

- file tree and git metadata
- package and workspace manifests
- source/config/test files relevant to selected workflows
- import or dependency graph output
- route, controller, service, command, or test symbols where the language ecosystem allows it

Recommended language order:

1. JavaScript and TypeScript first, using tools such as dependency-cruiser, madge, ts-morph, or the TypeScript Compiler API.
2. Python next, using import and API-structure tools where useful.
3. Java, C#, Go, and Rust later as seed adapters after the schema and validation model are stable.

Rust is not recommended as the default scripting language for the skill. Node.js is the better orchestration default because the likely analysis, JSON Schema, and browser rendering toolchain is JavaScript-oriented.

## Model and Prompting Pattern

The research recommends GPT-5.5 for primary flow synthesis and a cheaper model such as GPT-5.4-mini for verification or repair. Prompts should be outcome-first and should not request chain-of-thought. They should require:

- schema-conformant output
- evidence-backed claims
- explicit unknowns
- confidence values
- refusal to invent unsupported flows

If API orchestration is added, the Responses API and Structured Outputs are the recommended direction. For the first repo-local skill, a simpler approach may be enough: local extraction and validation scripts, with Codex performing synthesis using the skill instructions.

## Viewer Strategy

The first viewer should be static and offline-friendly. The JSON remains renderer-agnostic; the viewer can evolve independently.

Recommended default:

- Cytoscape.js for interactive graph viewing.
- Optional Graphviz layout generation for stable directed layouts.
- Single-file HTML for the first rollout, with bundled assets if external network access is not acceptable.

Minimum viewer interactions:

- choose a named workflow
- highlight participating nodes and edges
- show ordered flow steps
- show evidence for selected items
- show confidence and diagnostics
- filter by package, layer, workflow, or confidence threshold

## Security and Privacy

The skill should default to local extraction and minimal upload. It should not send raw repository contents unless the user has explicitly accepted that behavior for the target repository.

Required controls:

- avoid `.env`, credentials, tokens, and secrets
- redact suspicious snippets before model submission
- prefer file paths, symbols, hashes, and narrowed excerpts over full files
- set retention controls such as `store: false` when API orchestration is used and appropriate
- require human approval before externally publishing private architecture artifacts

## Recommended Starting Targets

The research and conversation suggest starting with bounded repositories before a large enterprise Angular application.

Recommended order:

1. `scryfall-mcp` as the easiest accuracy target.
2. `Planeview` as the strongest portfolio and architecture-demo target.
3. `clearfetch` for request lifecycle, hooks, errors, and extension points.
4. MUD/game engine project for command flow and state changes.
5. Enterprise Angular only after the workflow-slicing and confidence model have been proven.

The earlier conversation ranked `Planeview` first for portfolio payoff. For implementation risk, `scryfall-mcp` is likely the better first fixture.

## Open Decisions

- Whether the first skill should create fresh artifacts only or support incremental update mode immediately.
- Whether human edits to JSON should be preserved during regeneration.
- Whether the first HTML output embeds JSON or reads it from a sidecar file.
- Whether Cytoscape should be bundled into the HTML or treated as a local asset.
- Whether the MVP relies on Codex synthesis only or includes explicit OpenAI API orchestration scripts.
- Which fixture repository should define the first acceptance test.
- How much line-number precision is required in the first schema.
