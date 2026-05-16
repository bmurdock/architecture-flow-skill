import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(repoRoot, '.agents/skills/architecture-flows/scripts/validate-flows.mjs');
const fixture = (...parts) =>
  path.join(repoRoot, '.agents/skills/architecture-flows/fixtures', ...parts);

function runValidator(...args) {
  return spawnSync(process.execPath, [validator, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

describe('validate-flows.mjs', () => {
  it('accepts a minimal evidence-backed architecture flow artifact', () => {
    const result = runValidator(fixture('valid/minimal-flow.json'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /valid/i);
  });

  it('rejects artifacts missing required contract fields', () => {
    const result = runValidator(fixture('invalid/missing-required-field.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /metadata\.branch/);
  });

  it('rejects broken node, edge, flow, and evidence references', () => {
    const result = runValidator(fixture('invalid/broken-references.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown evidence reference "ev:missing"/);
    assert.match(result.stderr, /Unknown node reference "node:missing"/);
  });

  it('accepts fact provenance references from nodes, edges, and flow steps', () => {
    const result = runValidator(fixture('valid/strict-facts-flow.json'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /valid/i);
  });

  it('rejects duplicate fact ids', () => {
    const result = runValidator(fixture('invalid/duplicate-fact-id.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duplicate fact id "fact:server-entrypoint"/);
  });

  it('rejects derivedFrom references to missing facts', () => {
    const result = runValidator(fixture('invalid/strict-missing-derived-from.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown fact reference "fact:missing" at nodes\[0\]\.derivedFrom/);
  });

  it('rejects unsupported fact fields', () => {
    const result = runValidator(fixture('invalid/unsupported-fact-field.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /facts\[0\]\.unsupportedFactField is not allowed/);
  });

  it('rejects fact evidence references to missing evidence', () => {
    const result = runValidator(fixture('invalid/fact-missing-evidence.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown evidence reference "ev:missing" at facts\[0\]\.evidence/);
  });

  it('rejects flow steps that reference missing edges', () => {
    const result = runValidator(fixture('invalid/broken-step-edge.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown edge reference "edge:missing"/);
  });

  it('rejects invalid confidence values', () => {
    const result = runValidator(fixture('invalid/invalid-confidence.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid confidence value "certain"/);
  });

  it('rejects artifacts that violate the JSON schema', () => {
    const result = runValidator(fixture('invalid/schema-violation.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /root\.unexpectedRootProperty is not allowed/);
    assert.match(result.stderr, /metadata\.generationMode must be one of/);
    assert.match(result.stderr, /metadata\.privacy must be one of/);
  });
});
