# Architecture Flow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make architecture-flow artifacts materially harder to overclaim by adding strict claim provenance and replacing regex-only JS/TS extraction with parser-backed facts.

**Architecture:** Keep `architecture-flows.json` as the source of truth and preserve the current MVP workflow. Add a typed `facts` layer between scan evidence and final claims, then make strict verification require every normal claim to trace to deterministic fact IDs and fresh evidence hashes. Add a JS/TS parser adapter that produces those facts while keeping the existing regex scanner as a fallback diagnostic path.

**Tech Stack:** Node.js 24, native `node:test`, existing `.mjs` scripts, JSON Schema Draft 2020-12, `ts-morph` for JS/TS AST extraction.

---

## Why These Two Areas

The reviewed documents identify several valid gaps: regex extraction, shallow verifier semantics, manual synthesis, validator maintenance, coarse freshness, and distribution maturity. Local review confirms the scanner currently extracts imports with four regexes in `.agents/skills/architecture-flows/scripts/scan-repo.mjs` and symbols with three regex patterns. Local review also confirms `verify-flows.mjs` treats evidence as strong when it has a path plus a symbol, content hash, or direct-evidence wording.

The best return versus effort is:

1. Strict claim governance and provenance: high correctness return, moderate effort, no new runtime dependency required. This directly addresses verifier limits, manual synthesis risk, and coarse freshness.
2. Parser-backed JS/TS fact extraction: very high correctness return, higher but justified effort, one focused dependency. This addresses the source-quality weakness that strict mode needs to be useful.

Distribution packaging and dual validation are worthwhile later, but they do less to improve the trustworthiness of generated architecture claims.

## File Map

Modify:

- `.agents/skills/architecture-flows/references/architecture-flows.schema.json`: add optional `facts` root collection and `derivedFrom` claim provenance fields.
- `.agents/skills/architecture-flows/scripts/validate-flows.mjs`: validate fact IDs and `derivedFrom` references.
- `.agents/skills/architecture-flows/scripts/verify-flows.mjs`: add `--strict` mode and claim-provenance/freshness policy.
- `.agents/skills/architecture-flows/scripts/scan-repo.mjs`: call the JS/TS fact extractor and include `facts` in scan output.
- `.agents/skills/architecture-flows/scripts/normalize-evidence.mjs`: normalize parser facts with stable IDs and content hashes.
- `.agents/skills/architecture-flows/references/synthesis-instructions.md`: document strict-mode synthesis rules.
- `.agents/skills/architecture-flows/references/review-checklist.md`: add strict-mode review checklist items.
- `package.json`: add the `ts-morph` dependency and keep `npm test` unchanged.
- `.gitignore`: add `tmp/` so document/test scratch output does not enter scanner output.

Create:

- `.agents/skills/architecture-flows/scripts/extract-js-ts-facts.mjs`: parser-backed JS/TS extraction adapter.
- `.agents/skills/architecture-flows/fixtures/valid/strict-facts-flow.json`: strict-mode valid artifact.
- `.agents/skills/architecture-flows/fixtures/invalid/strict-missing-derived-from.json`: invalid strict artifact.
- `.agents/skills/architecture-flows/fixtures/invalid/strict-missing-content-hash.json`: invalid strict artifact.
- `.agents/skills/architecture-flows/fixtures/invalid/strict-missing-evidence-path.json`: invalid strict artifact.

Modify tests:

- `test/evidence-extraction.test.mjs`: parser extraction cases.
- `test/validate-flows.test.mjs`: schema and reference checks for facts.
- `test/verify-flows.test.mjs`: strict-mode failures and pass case.
- `test/golden-workflow.test.mjs`: strict-mode fixture validation if the golden artifact is upgraded.

## Task 1: Add Optional Fact and Claim Provenance Schema

**Files:**
- Modify: `.agents/skills/architecture-flows/references/architecture-flows.schema.json`
- Modify: `.agents/skills/architecture-flows/scripts/validate-flows.mjs`
- Test: `test/validate-flows.test.mjs`

- [ ] **Step 1: Write validator tests for fact references**

Add tests that assert the schema accepts `facts` and `derivedFrom`, rejects duplicate fact IDs, and rejects missing fact references.

```js
it('accepts optional facts and claim derivedFrom references', () => {
  const result = runValidator(fixture('valid/strict-facts-flow.json'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

it('rejects claim derivedFrom references that do not exist', () => {
  const result = runValidator(fixture('invalid/strict-missing-derived-from.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown fact reference "fact:missing" at nodes\[0\]\.derivedFrom/);
});
```

Run: `npm test -- test/validate-flows.test.mjs`
Expected: FAIL because the schema and validator do not know about `facts` or `derivedFrom` yet.

- [ ] **Step 2: Extend the schema**

Add root `facts` as optional for backward compatibility:

```json
"facts": {
  "type": "array",
  "items": { "$ref": "#/$defs/fact" },
  "default": []
}
```

Add `derivedFrom` to `node`, `edge`, and `flowStep`:

```json
"derivedFrom": {
  "type": "array",
  "items": { "type": "string", "minLength": 1 }
}
```

Add this `$defs.fact` shape:

```json
"fact": {
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "kind", "path", "provenance", "evidence"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "kind": {
      "type": "string",
      "enum": ["import", "export", "symbol", "entrypoint", "manifest", "route", "config"]
    },
    "path": { "type": "string", "minLength": 1 },
    "symbol": { "type": "string" },
    "source": { "type": "string" },
    "target": { "type": "string" },
    "language": { "type": "string" },
    "provenance": { "type": "string", "minLength": 1 },
    "evidence": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string", "minLength": 1 }
    },
    "location": { "$ref": "#/$defs/location" }
  }
}
```

Extract the existing evidence location object into `$defs.location` so both evidence and facts can reuse it.

- [ ] **Step 3: Extend semantic validation for fact references**

In `validate-flows.mjs`, read facts after diagnostics:

```js
const facts = Array.isArray(artifact.facts) ? artifact.facts : [];
const factIds = collectIds(errors, facts, 'fact');
```

Add a helper:

```js
function validateFactReferences(errors, factRefs, factIds, context) {
  if (factRefs === undefined) {
    return;
  }
  if (!Array.isArray(factRefs) || factRefs.length === 0) {
    errors.push(`${context}.derivedFrom must include at least one fact id when present`);
    return;
  }
  for (const factId of factRefs) {
    if (!factIds.has(factId)) {
      errors.push(`Unknown fact reference "${factId}" at ${context}.derivedFrom`);
    }
  }
}
```

Call it for every node, edge, and flow step.

- [ ] **Step 4: Verify validator behavior**

Run: `npm test -- test/validate-flows.test.mjs`
Expected: PASS.

Run: `node .agents/skills/architecture-flows/scripts/validate-flows.mjs .agents/skills/architecture-flows/fixtures/valid/minimal-flow.json`
Expected: PASS to confirm legacy artifacts remain valid.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/architecture-flows/references/architecture-flows.schema.json \
  .agents/skills/architecture-flows/scripts/validate-flows.mjs \
  .agents/skills/architecture-flows/fixtures/valid/strict-facts-flow.json \
  .agents/skills/architecture-flows/fixtures/invalid/strict-missing-derived-from.json \
  test/validate-flows.test.mjs
git commit -m "feat: add architecture fact provenance schema"
```

## Task 2: Add Strict Verification Mode

**Files:**
- Modify: `.agents/skills/architecture-flows/scripts/verify-flows.mjs`
- Test: `test/verify-flows.test.mjs`
- Fixtures: strict valid and invalid fixtures

- [ ] **Step 1: Write strict verifier tests**

Add these test cases:

```js
it('passes strict mode for fact-derived fresh evidence', () => {
  const result = runVerifier('--strict', '--repo', repoRoot, fixture('valid/strict-facts-flow.json'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /verified/);
});

it('requires derivedFrom in strict mode', () => {
  const result = runVerifier('--strict', fixture('invalid/strict-missing-derived-from.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nodes\[0\] must include derivedFrom in strict mode/);
});

it('requires content hashes in strict mode when repo context is supplied', () => {
  const result = runVerifier('--strict', '--repo', repoRoot, fixture('invalid/strict-missing-content-hash.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /evidence\[0\].*must include sha256 contentHash in strict mode/);
});
```

Run: `npm test -- test/verify-flows.test.mjs`
Expected: FAIL because `--strict` is not implemented.

- [ ] **Step 2: Parse `--strict`**

Update usage:

```text
Usage: verify-flows.mjs [--strict] [--repo <path>] <architecture-flows.json> [...]
```

Update `parseArgs` to return:

```js
return {
  files,
  repoPath: repoPath ? path.resolve(repoPath) : null,
  strict
};
```

- [ ] **Step 3: Add strict policy checks**

Add `verifyStrictClaimProvenance`:

```js
function verifyStrictClaimProvenance(errors, item, factIds, context) {
  const refs = asArray(item?.derivedFrom);
  if (refs.length === 0) {
    errors.push(`${context} must include derivedFrom in strict mode`);
    return;
  }
  for (const ref of refs) {
    if (!factIds.has(ref)) {
      errors.push(`${context} references missing fact "${ref}" in derivedFrom`);
    }
  }
}
```

Add `verifyStrictEvidenceFreshness`:

```js
function verifyStrictEvidenceFreshness(errors, artifact, repoPath) {
  if (!repoPath) {
    errors.push('strict mode requires --repo so evidence freshness can be checked');
    return;
  }
  for (const [index, evidence] of asArray(artifact.evidence).entries()) {
    if (!isObject(evidence)) continue;
    if (typeof evidence.contentHash !== 'string' || !evidence.contentHash.startsWith('sha256:')) {
      errors.push(`evidence[${index}] ${evidence.id ?? evidence.path ?? ''} must include sha256 contentHash in strict mode`);
    }
  }
}
```

Call strict provenance for nodes, edges, and flow steps. Call strict freshness before returning diagnostics.

- [ ] **Step 4: Promote selected warnings to strict errors**

In strict mode, these existing warnings become errors:

- repository context not supplied
- metadata commit is not a 40-character hash
- no evidence records include contentHash
- evidence path not found
- unsupported contentHash format
- evidence reason uses inference wording
- flow name/summary/trigger uses inference wording

Implementation pattern:

```js
function addDiagnostic(strict, errors, warnings, message) {
  if (strict) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}
```

Use this helper only for warnings that strict mode must block.

- [ ] **Step 5: Verify strict and legacy behavior**

Run: `npm test -- test/verify-flows.test.mjs`
Expected: PASS.

Run: `node .agents/skills/architecture-flows/scripts/verify-flows.mjs .agents/skills/architecture-flows/fixtures/valid/minimal-flow.json`
Expected: PASS with existing warning behavior.

Run: `node .agents/skills/architecture-flows/scripts/verify-flows.mjs --strict .agents/skills/architecture-flows/fixtures/valid/minimal-flow.json`
Expected: FAIL because strict mode requires fact provenance and repo freshness.

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/architecture-flows/scripts/verify-flows.mjs \
  .agents/skills/architecture-flows/fixtures/valid/strict-facts-flow.json \
  .agents/skills/architecture-flows/fixtures/invalid/strict-missing-content-hash.json \
  .agents/skills/architecture-flows/fixtures/invalid/strict-missing-evidence-path.json \
  test/verify-flows.test.mjs
git commit -m "feat: add strict architecture flow verification"
```

## Task 3: Add Parser-Backed JS/TS Fact Extraction

**Files:**
- Create: `.agents/skills/architecture-flows/scripts/extract-js-ts-facts.mjs`
- Modify: `.agents/skills/architecture-flows/scripts/scan-repo.mjs`
- Modify: `.agents/skills/architecture-flows/scripts/normalize-evidence.mjs`
- Modify: `package.json`
- Test: `test/evidence-extraction.test.mjs`

- [ ] **Step 1: Add focused dependency**

Run:

```bash
npm install ts-morph
```

Expected: `package.json` gains `dependencies.ts-morph`; `package-lock.json` is created if absent. This dependency is justified because parser-backed JS/TS extraction is the core correctness upgrade and is explicitly in scope.

- [ ] **Step 2: Write parser extraction tests**

In `test/evidence-extraction.test.mjs`, add a fixture file with constructs the regex scanner misses:

```js
fs.writeFileSync(
  path.join(root, 'src/modern.tsx'),
  [
    "import React from 'react';",
    "export { createServer as makeServer } from './server.js';",
    'export default function App() { return null; }',
    'export const routeHandler = async () => null;',
    'export interface UserRecord { id: string }',
    'export type UserId = string;',
    'export enum Status { Ready = "ready" }'
  ].join('\n')
);
```

Assert:

```js
assert(scan.facts.some((fact) => fact.kind === 'import' && fact.source === 'react'));
assert(scan.facts.some((fact) => fact.kind === 'export' && fact.source === './server.js'));
assert(scan.facts.some((fact) => fact.kind === 'symbol' && fact.symbol === 'App'));
assert(scan.facts.some((fact) => fact.kind === 'symbol' && fact.symbol === 'routeHandler'));
assert(scan.facts.some((fact) => fact.kind === 'symbol' && fact.symbol === 'UserRecord'));
assert(scan.facts.some((fact) => fact.kind === 'symbol' && fact.symbol === 'UserId'));
assert(scan.facts.some((fact) => fact.kind === 'symbol' && fact.symbol === 'Status'));
assert(scan.facts.every((fact) => fact.provenance === 'js-ts-ast'));
```

Run: `npm test -- test/evidence-extraction.test.mjs`
Expected: FAIL because `scan.facts` does not exist.

- [ ] **Step 3: Implement `extract-js-ts-facts.mjs`**

Export:

```js
export function extractJsTsFacts(repoPath, files) {
  return {
    facts,
    diagnostics
  };
}
```

Fact shape:

```js
{
  kind: 'symbol',
  path: 'src/modern.tsx',
  symbol: 'routeHandler',
  language: 'typescript',
  provenance: 'js-ts-ast',
  location: { startLine: 4, endLine: 4 }
}
```

Use `ts-morph` `Project` with:

```js
const project = new Project({
  useInMemoryFileSystem: false,
  compilerOptions: {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  },
  skipAddingFilesFromTsConfig: true
});
```

Extract:

- `ImportDeclaration` module specifiers as `kind: 'import'`
- `ExportDeclaration` module specifiers as `kind: 'export'`
- `CallExpression` literal `require("x")` and `import("x")` as `kind: 'import'`
- exported `FunctionDeclaration`, `ClassDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, and `EnumDeclaration` as `kind: 'symbol'`
- exported variable declarations, including arrow functions, as `kind: 'symbol'`
- default exported function/class names as their declared name, or `default` if anonymous

On parse failure, add diagnostic:

```js
{
  id: `js-ts-parse-fallback:${relativePath}`,
  severity: 'warning',
  message: `Parser extraction failed for ${relativePath}; regex fallback was used.`
}
```

- [ ] **Step 4: Wire facts into scanner output**

In `scan-repo.mjs`, import:

```js
import { extractJsTsFacts } from './extract-js-ts-facts.mjs';
```

After `sourceFiles`:

```js
const astExtraction = extractJsTsFacts(repoPath, sourceFiles);
```

Return:

```js
facts: astExtraction.facts,
diagnostics: astExtraction.diagnostics
```

Keep existing `imports` and `symbols` arrays for backward compatibility until downstream consumers are migrated.

- [ ] **Step 5: Normalize facts with stable IDs**

In `normalize-evidence.mjs`, add:

```js
facts: normalizeCollection(scan.facts ?? [], (item) => stableId('fact', [item.kind, item.path, item.symbol ?? item.source ?? item.target ?? 'item'], item), (item) => ({
  kind: item.kind,
  path: item.path,
  symbol: item.symbol,
  source: item.source,
  target: item.target,
  language: item.language,
  provenance: item.provenance,
  location: item.location
}))
```

Preserve existing output keys and append `facts` after `entrypoints` to minimize churn:

```js
['metadata', 'fileTree', 'files', 'manifests', 'imports', 'symbols', 'entrypoints', 'facts', 'redactions', 'diagnostics']
```

- [ ] **Step 6: Verify parser extraction**

Run: `npm test -- test/evidence-extraction.test.mjs`
Expected: PASS.

Run:

```bash
node .agents/skills/architecture-flows/scripts/scan-repo.mjs . > /tmp/architecture-flow-scan.json
node .agents/skills/architecture-flows/scripts/normalize-evidence.mjs /tmp/architecture-flow-scan.json > /tmp/architecture-flow-evidence.json
```

Expected: both commands exit 0; normalized evidence contains a `facts` array with `js-ts-ast` provenance.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json \
  .agents/skills/architecture-flows/scripts/extract-js-ts-facts.mjs \
  .agents/skills/architecture-flows/scripts/scan-repo.mjs \
  .agents/skills/architecture-flows/scripts/normalize-evidence.mjs \
  test/evidence-extraction.test.mjs
git commit -m "feat: extract js ts facts with ast parser"
```

## Task 4: Generate Evidence Hashes for Strict Mode

**Files:**
- Modify: `.agents/skills/architecture-flows/scripts/scan-repo.mjs`
- Modify: `.agents/skills/architecture-flows/scripts/normalize-evidence.mjs`
- Test: `test/evidence-extraction.test.mjs`

- [ ] **Step 1: Add tests for content hashes**

Assert all normalized source/config evidence has a SHA-256 file hash:

```js
assert(bundle.files.every((file) => typeof file.contentHash === 'string' && file.contentHash.startsWith('sha256:')));
assert(bundle.facts.every((fact) => fact.evidence.length > 0));
```

Expected: FAIL until hashes and fact evidence links exist.

- [ ] **Step 2: Add `sha256File` helper to scanner or normalizer**

Use the same format as `verify-flows.mjs`:

```js
function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}
```

Add `contentHash` to candidate file descriptions in `describeFile`.

- [ ] **Step 3: Link facts to file evidence**

In normalization, create a map from path to normalized file evidence ID. For each fact, set:

```js
evidence: [fileEvidenceIdByPath.get(item.path)].filter(Boolean)
```

If the file evidence ID is missing, emit a diagnostic:

```js
{
  id: `fact-without-file-evidence:${item.path}`,
  severity: 'warning',
  message: `Fact for ${item.path} has no normalized file evidence.`
}
```

- [ ] **Step 4: Verify hashes**

Run: `npm test -- test/evidence-extraction.test.mjs test/verify-flows.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/architecture-flows/scripts/scan-repo.mjs \
  .agents/skills/architecture-flows/scripts/normalize-evidence.mjs \
  test/evidence-extraction.test.mjs
git commit -m "feat: attach evidence hashes to extracted facts"
```

## Task 5: Update Workflow Docs and Review Gates

**Files:**
- Modify: `.agents/skills/architecture-flows/references/synthesis-instructions.md`
- Modify: `.agents/skills/architecture-flows/references/review-checklist.md`
- Modify: `README.md`
- Modify: `PURPOSE.md` only if wording currently overstates verification
- Test: `test/golden-workflow.test.mjs`

- [ ] **Step 1: Add documentation tests**

In `test/golden-workflow.test.mjs`, assert the instructions mention:

```js
assert.match(instructions, /--strict/);
assert.match(instructions, /derivedFrom/);
assert.match(instructions, /facts/);
assert.match(checklist, /strict mode/i);
```

Expected: FAIL until docs are updated.

- [ ] **Step 2: Update synthesis instructions**

Add a strict-mode section:

```markdown
## Strict Mode

Use strict mode when the user needs a high-assurance artifact or CI-gated regeneration.

- Every node, edge, and flow step must include `derivedFrom`.
- Every `derivedFrom` value must reference a deterministic fact ID.
- Every fact must reference evidence.
- Every evidence record used by facts must include a `sha256:` content hash when repository context is available.
- Run `verify-flows.mjs --strict --repo <source-repo>` before rendering.
- If strict verification fails, remove the claim, regenerate facts, downgrade the claim into diagnostics, or stop for human review.
```

- [ ] **Step 3: Update README command examples**

Add the strict command after the existing verifier command:

```bash
node .agents/skills/architecture-flows/scripts/verify-flows.mjs --strict --repo /path/to/repo docs/architecture/architecture-flows.json
```

Explain that non-strict mode remains useful for draft artifacts.

- [ ] **Step 4: Verify docs**

Run: `npm test -- test/golden-workflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/architecture-flows/references/synthesis-instructions.md \
  .agents/skills/architecture-flows/references/review-checklist.md \
  README.md PURPOSE.md test/golden-workflow.test.mjs
git commit -m "docs: document strict architecture flow workflow"
```

## Task 6: Upgrade Golden Fixture or Add Strict Golden Fixture

**Files:**
- Modify or create: `.agents/skills/architecture-flows/fixtures/golden/tiny-node-service/architecture-flows.json`
- Test: `test/golden-workflow.test.mjs`
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Decide fixture strategy**

Prefer adding a new strict golden fixture if changing the existing golden artifact would create noisy review churn:

```text
.agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
```

- [ ] **Step 2: Add strict fixture CI checks**

Update `.github/workflows/test.yml` to run:

```bash
node .agents/skills/architecture-flows/scripts/validate-flows.mjs \
  .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
node .agents/skills/architecture-flows/scripts/verify-flows.mjs \
  --strict \
  --repo .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict \
  .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
```

- [ ] **Step 3: Verify full suite**

Run: `npm test`
Expected: 0 failures.

Run:

```bash
node .agents/skills/architecture-flows/scripts/validate-flows.mjs \
  .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
node .agents/skills/architecture-flows/scripts/verify-flows.mjs \
  --strict \
  --repo .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict \
  .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
```

Expected: both pass without warnings.

- [ ] **Step 4: Commit**

```bash
git add .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict \
  .github/workflows/test.yml test/golden-workflow.test.mjs
git commit -m "test: add strict golden architecture flow"
```

## Task 7: Clean Local Scratch Handling

**Files:**
- Modify: `.gitignore`
- Modify: `.agents/skills/architecture-flows/scripts/scan-repo.mjs`
- Test: `test/evidence-extraction.test.mjs`

- [ ] **Step 1: Add `tmp/` to `.gitignore`**

Add:

```gitignore
tmp/
```

- [ ] **Step 2: Ignore common scratch dirs in scanner**

Add `tmp` to `ignoredDirectories` in both `scan-repo.mjs` and `check-secrets.mjs`:

```js
'tmp',
```

- [ ] **Step 3: Verify scanner excludes scratch output**

Run:

```bash
mkdir -p tmp/scanner-ignore && printf 'export function ignored() {}\\n' > tmp/scanner-ignore/ignored.js
node .agents/skills/architecture-flows/scripts/scan-repo.mjs . > /tmp/architecture-flow-scan.json
node -e "const s=require('/tmp/architecture-flow-scan.json'); if (JSON.stringify(s).includes('tmp/scanner-ignore')) process.exit(1)"
```

Expected: exit 0.

- [ ] **Step 4: Clean temp directory**

Run:

```bash
rm -rf tmp/scanner-ignore
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore \
  .agents/skills/architecture-flows/scripts/scan-repo.mjs \
  .agents/skills/architecture-flows/scripts/check-secrets.mjs \
  test/evidence-extraction.test.mjs
git commit -m "chore: ignore local scratch output in scans"
```

## Final Verification

- [ ] Run unit tests:

```bash
npm test
```

Expected: all tests pass.

- [ ] Run draft verifier compatibility:

```bash
node .agents/skills/architecture-flows/scripts/verify-flows.mjs \
  .agents/skills/architecture-flows/fixtures/valid/minimal-flow.json
```

Expected: pass with the existing non-strict warning model.

- [ ] Run strict fixture verification:

```bash
node .agents/skills/architecture-flows/scripts/verify-flows.mjs \
  --strict \
  --repo .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict \
  .agents/skills/architecture-flows/fixtures/golden/tiny-node-service-strict/architecture-flows.json
```

Expected: pass with no warnings.

- [ ] Run scanner and normalizer on this repo:

```bash
node .agents/skills/architecture-flows/scripts/scan-repo.mjs . > /tmp/architecture-flow-scan.json
node .agents/skills/architecture-flows/scripts/normalize-evidence.mjs /tmp/architecture-flow-scan.json > /tmp/architecture-flow-evidence.json
```

Expected: both exit 0; `/tmp/architecture-flow-evidence.json` contains `facts` with `js-ts-ast` provenance.

## Remaining Risks

- `ts-morph` improves JS/TS extraction but does not prove runtime behavior such as dependency injection, framework routing, queues, or database effects.
- Strict mode will initially be more demanding than existing artifacts can satisfy; keep non-strict mode for drafts.
- Content hashes are file-level in this plan. Symbol- or AST-node-level hashes are a later improvement once parser facts are stable.
- The custom validator remains in place. Standards-based shape validation with Ajv is still a useful follow-up, but lower leverage than claim provenance and AST facts.

