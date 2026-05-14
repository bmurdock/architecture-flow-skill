# Schema Notes

The canonical schema is `references/architecture-flows.schema.json`. Generated repositories should receive a copied schema at `docs/architecture/architecture-flows.schema.json` for reviewability.

The contract favors symbol-level evidence with optional line ranges. Line numbers are useful for inspection but should not be required for every claim because they drift frequently.

Evidence records are reusable and first-class. Nodes, edges, diagnostics, and flow steps reference evidence by ID instead of embedding loose source explanations.

The validator performs semantic checks that JSON Schema alone cannot express cleanly:

- duplicate IDs
- broken evidence references
- broken node references
- invalid confidence values
- low-confidence normal items without uncertainty reasons
- unsupported normal items
