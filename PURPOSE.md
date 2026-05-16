# PURPOSE

## Why this project exists

This project exists to maintain a Codex skill that generates architecture flow maps from real repositories. The skill should help a developer understand important workflows across packages, components, services, routes, tests, data stores, and external integrations without pretending that a diagram alone is architecture truth.

The motivating idea is useful: produce a human-readable HTML view and a machine-readable JSON file that future Codex sessions can use as context. The hard part is making that output trustworthy. A skill that simply asks a model to infer a whole application can produce plausible but unsupported diagrams. This project exists to ship the safer version: local extraction first, evidence-backed JSON as the source of truth, schema validation, explicit uncertainty, and review gates where confidence is low.

The project currently contains the first MVP of that skill, including scanner, normalizer, validator, verifier, incremental planning, viewer rendering, fixtures, tests, and workflow documentation. Its job is to keep the skill useful, auditable, and conservative as it grows beyond the initial JavaScript and TypeScript-oriented workflow.

## Design goals

- Treat `architecture-flows.json` as the durable contract and HTML as a viewer over that contract.
- Require evidence for meaningful claims, including file paths, symbols, snippets, tests, static traces, or runtime traces where available.
- Preserve uncertainty with confidence values, provenance, diagnostics, and documented gaps.
- Prefer important workflows over exhaustive whole-repo diagrams.
- Keep generation local-first and privacy-aware, sending only narrowed evidence bundles to model synthesis when model calls are used.
- Make artifacts repeatable, diffable, and suitable for review in pull requests or future Codex sessions.
- Keep the MVP small and useful before adding broader language coverage, richer viewer behavior, or API orchestration.

## Non-goals

This project does not aim to:

- Build an architecture oracle that claims complete knowledge of arbitrary repositories.
- Generate visually impressive graphs that cannot be audited back to source evidence.
- Map every component in large applications by default.
- Replace ADRs, human architecture review, or project-specific vocabulary.
- Depend on heavyweight infrastructure, Rust accelerators, hosted agents, or mandatory CI automation for the usable local workflow.
- Publish private architecture artifacts or upload raw repository contents without an explicit privacy decision.
- Optimize first for the large enterprise Angular case study before the workflow and evidence model are proven on smaller repositories.

## Philosophy

This project should feel like a code-reviewable architecture instrument: evidence-first, schema-first, scoped, repeatable, and honest about uncertainty.

It should not feel like a social-media prompt demo, a static import graph with nicer styling, or a polished diagram that quietly invents runtime behavior.

## Long-term standard

Every feature, dependency, script, prompt, schema field, or viewer interaction should justify itself in terms of:

- evidence quality
- reviewability
- repeatable generation
- privacy and secret-safety
- usefulness to humans inspecting architecture
- usefulness to future Codex sessions
- incremental complexity added to the skill

If a change makes the artifact prettier but less auditable, it should be rejected. If a change broadens language support but weakens confidence reporting or validation, it should wait. If a change makes the skill harder to run on a normal local repository, it needs a clear payoff.
