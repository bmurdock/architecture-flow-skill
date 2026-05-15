import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(repoRoot, '.agents/skills/architecture-flows/scripts/render-viewer.mjs');
const fixture = (...parts) =>
  path.join(repoRoot, '.agents/skills/architecture-flows/fixtures', ...parts);

function runRenderer(...args) {
  return spawnSync(process.execPath, [renderer, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-flows-viewer-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function extractEmbeddedJson(html) {
  const match = html.match(
    /<script id="architecture-flows-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  assert(match, 'expected embedded architecture flow JSON script tag');
  return match[1];
}

describe('render-viewer.mjs', () => {
  it('renders a self-contained viewer with escaped embedded JSON and required panels', () => {
    withTempDir((dir) => {
      const artifactPath = path.join(dir, 'architecture-flows.json');
      const outputPath = path.join(dir, 'architecture-flows.html');
      const artifact = JSON.parse(fs.readFileSync(fixture('valid/minimal-flow.json'), 'utf8'));
      artifact.metadata.renderEscapeProbe = '</script><img src=x onerror=alert(1)>';
      fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

      const result = runRenderer(artifactPath, outputPath);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /rendered/i);
      const html = fs.readFileSync(outputPath, 'utf8');
      assert.match(html, /flow-select/);
      assert.match(html, /steps-panel/);
      assert.match(html, /evidence-panel/);
      assert.match(html, /confidence-panel/);
      assert.match(html, /diagnostics-panel/);
      assert.doesNotMatch(html, /<\/script><img/);

      const embedded = extractEmbeddedJson(html);
      assert.equal(JSON.parse(embedded).metadata.renderEscapeProbe, artifact.metadata.renderEscapeProbe);
    });
  });

  it('fails clearly for invalid JSON and removes stale output', () => {
    withTempDir((dir) => {
      const outputPath = path.join(dir, 'architecture-flows.html');
      fs.writeFileSync(outputPath, 'stale viewer');

      const result = runRenderer(fixture('invalid/missing-required-field.json'), outputPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /validation failed/i);
      assert.match(result.stderr, /metadata\.branch/);
      assert.equal(fs.existsSync(outputPath), false);
    });
  });

  it('fails clearly for missing input JSON and removes stale output', () => {
    withTempDir((dir) => {
      const missingPath = path.join(dir, 'missing.json');
      const outputPath = path.join(dir, 'architecture-flows.html');
      fs.writeFileSync(outputPath, 'stale viewer');

      const result = runRenderer(missingPath, outputPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /validation failed/i);
      assert.equal(fs.existsSync(outputPath), false);
    });
  });

  it('rejects using the source JSON as the output path without modifying it', () => {
    withTempDir((dir) => {
      const artifactPath = path.join(dir, 'architecture-flows.json');
      const original = fs.readFileSync(fixture('valid/minimal-flow.json'), 'utf8');
      fs.writeFileSync(artifactPath, original);

      const result = runRenderer(artifactPath, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must be different/i);
      assert.equal(fs.readFileSync(artifactPath, 'utf8'), original);
    });
  });

  it('rejects output symlinks that point at the source JSON', { skip: process.platform === 'win32' }, () => {
    withTempDir((dir) => {
      const artifactPath = path.join(dir, 'architecture-flows.json');
      const outputPath = path.join(dir, 'architecture-flows.html');
      const original = fs.readFileSync(fixture('valid/minimal-flow.json'), 'utf8');
      fs.writeFileSync(artifactPath, original);
      fs.symlinkSync(artifactPath, outputPath);

      const result = runRenderer(artifactPath, outputPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must be different/i);
      assert.equal(fs.readFileSync(artifactPath, 'utf8'), original);
    });
  });

  it('rejects output hard links that point at the source JSON', { skip: process.platform === 'win32' }, () => {
    withTempDir((dir) => {
      const artifactPath = path.join(dir, 'architecture-flows.json');
      const outputPath = path.join(dir, 'architecture-flows.html');
      const original = fs.readFileSync(fixture('valid/minimal-flow.json'), 'utf8');
      fs.writeFileSync(artifactPath, original);
      fs.linkSync(artifactPath, outputPath);

      const result = runRenderer(artifactPath, outputPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must be different/i);
      assert.equal(fs.readFileSync(artifactPath, 'utf8'), original);
    });
  });
});
