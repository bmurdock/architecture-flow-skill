import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, '.agents/skills/architecture-flows');
const validator = path.join(skillRoot, 'scripts/validate-flows.mjs');
const verifier = path.join(skillRoot, 'scripts/verify-flows.mjs');
const renderer = path.join(skillRoot, 'scripts/render-viewer.mjs');
const goldenRoot = path.join(skillRoot, 'fixtures/golden/tiny-node-service');
const goldenArtifact = path.join(goldenRoot, 'architecture-flows.json');
const strictGoldenRoot = path.join(skillRoot, 'fixtures/golden/tiny-node-service-strict');
const strictGoldenArtifact = path.join(strictGoldenRoot, 'architecture-flows.json');
const reviewChecklist = path.join(skillRoot, 'references/review-checklist.md');
const synthesisInstructions = path.join(skillRoot, 'references/synthesis-instructions.md');

function runScript(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-golden-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeArtifactWithCurrentCommit(sourcePath, outputPath) {
  const artifact = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  artifact.metadata.commit = currentCommit();
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

function embeddedArtifact(html) {
  const match = html.match(
    /<script id="architecture-flows-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  assert(match, 'expected rendered viewer to embed architecture flow JSON');
  return JSON.parse(match[1]);
}

describe('Phase 5 golden workflow', () => {
  it('validates, verifies, and renders the committed tiny service golden artifact', () => {
    const validate = runScript(validator, goldenArtifact);
    assert.equal(validate.status, 0, validate.stderr || validate.stdout);

    const verify = runScript(verifier, '--repo', goldenRoot, goldenArtifact);
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);
    assert.match(verify.stdout, /verified with warnings/i);
    assert.match(verify.stdout, /metadata\.commit is not a verifiable 40-character git hash/);

    withTempDir((dir) => {
      const outputPath = path.join(dir, 'architecture-flows.html');
      const render = runScript(renderer, goldenArtifact, outputPath);
      assert.equal(render.status, 0, render.stderr || render.stdout);

      const html = fs.readFileSync(outputPath, 'utf8');
      assert.match(html, /flow-select/);
      assert.match(html, /steps-panel/);
      assert.match(html, /evidence-panel/);
      assert.match(html, /confidence-panel/);
      assert.match(html, /diagnostics-panel/);

      const artifact = embeddedArtifact(html);
      assert.equal(artifact.metadata.repository, 'tiny-node-service');
      assert.equal(artifact.metadata.privacy, 'local-only');
      assert.deepEqual(
        artifact.flows.map((flow) => flow.id),
        ['flow:http-greeting']
      );
      assert(artifact.evidence.every((item) => item.contentHash?.startsWith('sha256:')));
    });
  });

  it('validates and strictly verifies the fact-derived tiny service golden artifact', () => {
    const validate = runScript(validator, strictGoldenArtifact);
    assert.equal(validate.status, 0, validate.stderr || validate.stdout);

    withTempDir((dir) => {
      const patchedArtifact = path.join(dir, 'architecture-flows.json');
      writeArtifactWithCurrentCommit(strictGoldenArtifact, patchedArtifact);

      const verify = runScript(verifier, '--strict', '--repo', strictGoldenRoot, patchedArtifact);
      assert.equal(verify.status, 0, verify.stderr || verify.stdout);
      assert.match(verify.stdout, /verified/i);
      assert.doesNotMatch(verify.stdout, /warning/i);
    });
  });

  it('keeps the review checklist explicit about low-confidence delta review', () => {
    const checklist = fs.readFileSync(reviewChecklist, 'utf8');

    assert.match(checklist, /low-confidence deltas/i);
    assert.match(checklist, /human review/i);
    assert.match(checklist, /warnings are reviewed/i);
    assert.match(checklist, /strict mode/i);
  });

  it('keeps synthesis instructions pinned to evidence-backed local-only JSON output', () => {
    const instructions = fs.readFileSync(synthesisInstructions, 'utf8');

    assert.match(instructions, /local evidence only/i);
    assert.match(instructions, /metadata\.privacy/i);
    assert.match(instructions, /local-only/i);
    assert.match(instructions, /Do not invent nodes, edges, steps/i);
    assert.match(instructions, /Reuse evidence IDs across nodes, edges, and flow steps/i);
    assert.match(instructions, /Generate only schema-conformant JSON/i);
    assert.match(instructions, /Do not include markdown fences/i);
    assert.match(instructions, /validate-flows\.mjs/);
    assert.match(instructions, /verify-flows\.mjs/);
    assert.match(instructions, /--strict/);
    assert.match(instructions, /derivedFrom/);
    assert.match(instructions, /facts/);
    assert.match(instructions, /uncertaintyReason/);
  });
});
