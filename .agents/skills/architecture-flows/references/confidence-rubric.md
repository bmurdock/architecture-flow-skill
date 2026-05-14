# Confidence Rubric

Confidence values are `high`, `medium`, or `low`.

## High

Use `high` when direct evidence supports the item. Examples include a symbol definition, static import, route registration, manifest entry, test case, or explicit configuration record.

High-confidence normal items should reference evidence with a path and either a symbol or a direct static relation.

## Medium

Use `medium` when evidence exists but the relationship is partially inferred from naming, nearby calls, tests, configuration, or conventional framework behavior.

Medium-confidence items must still reference evidence. Do not use medium as a substitute for missing evidence.

## Low

Use `low` when evidence exists but the relationship is uncertain, incomplete, dynamic, or framework-mediated.

Low-confidence nodes, edges, and flow steps must include `uncertaintyReason`.

## Unsupported

Unsupported claims must not appear as normal nodes, edges, or flow steps. Put them in diagnostics with the available evidence and the reason they were not promoted.
