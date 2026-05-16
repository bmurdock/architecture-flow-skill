import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = path.join(repoRoot, '.agents/skills/architecture-flows/scripts');
const scanRepo = path.join(scriptsDir, 'scan-repo.mjs');
const normalizeEvidence = path.join(scriptsDir, 'normalize-evidence.mjs');
const checkSecrets = path.join(scriptsDir, 'check-secrets.mjs');
const fixtureRepo = '/Users/brianmurdock/Documents/augment-projects/scryfall-mcp';

function runScript(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function cleanupTempDir(t, root) {
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function makeFixtureRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-evidence-'));
  cleanupTempDir(t, root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: '@fixture/evidence-demo',
      type: 'module',
      main: './src/index.js',
      exports: {
        '.': './src/index.js',
        './cli': {
          import: './src/cli.ts',
          require: './src/cli.cjs'
        },
        './feature': {
          node: {
            import: './src/feature.js'
          },
          default: './src/feature-browser.js'
        }
      },
      bin: { demo: './src/cli.ts' },
      scripts: { test: 'node --test' },
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(root, 'src/index.js'),
    [
      "import { createServer } from './server.js';",
      "export function main() {",
      '  return createServer();',
      '}',
      '',
      'main();'
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(root, 'src/server.js'),
    [
      "import express from 'express';",
      '',
      'export class ApiServer {',
      '  start() {',
      "    return 'ok';",
      '  }',
      '}',
      '',
      'export function createServer() {',
      '  return new ApiServer();',
      '}'
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(root, 'src/cli.ts'),
    [
      '#!/usr/bin/env node',
      "import { main } from './index.js';",
      '',
      'main();'
    ].join('\n')
  );
  fs.writeFileSync(path.join(root, 'src/feature.js'), "export const feature = 'node';\n");
  fs.writeFileSync(path.join(root, 'src/feature-browser.js'), "export const feature = 'browser';\n");
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
  fs.writeFileSync(path.join(root, 'src/cli.cjs'), "module.exports = require('./cli.ts');\n");
  fs.writeFileSync(
    path.join(root, 'test/server.test.js'),
    "import { createServer } from '../src/server.js';\ncreateServer();\n"
  );
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=sk-test-1234567890abcdef1234567890abcdef\n');
  fs.writeFileSync(path.join(root, 'config.json'), '{"token":"Ab3dE9fGh2JkL8mNo5PqR7sTu0VxYz12"}\n');

  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['add', 'package.json', 'src', 'test'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'fixture'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  });

  return root;
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function writeJsonFixture(t, prefix, name, value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupTempDir(t, root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
  return filePath;
}

describe('Phase 2 evidence extraction scripts', () => {
  it('scans a repository for git metadata, manifests, candidate files, imports, symbols, entrypoints, and redactions', (t) => {
    const root = makeFixtureRepo(t);
    const scan = parseJson(runScript(scanRepo, root));

    assert.equal(scan.metadata.repositoryPath, root);
    assert.equal(scan.metadata.git.branch.length > 0, true);
    assert.match(scan.metadata.git.commit, /^[a-f0-9]{40}$/);
    assert.deepEqual(scan.manifests.map((manifest) => manifest.path), ['package.json']);
    assert.deepEqual(
      scan.files.map((file) => file.path),
      [
        'config.json',
        'package.json',
        'src/cli.cjs',
        'src/cli.ts',
        'src/feature-browser.js',
        'src/feature.js',
        'src/index.js',
        'src/modern.tsx',
        'src/server.js',
        'test/server.test.js'
      ]
    );
    assert.deepEqual(
      scan.fileTree.map((file) => file.path),
      [
        'config.json',
        'package.json',
        'src/cli.cjs',
        'src/cli.ts',
        'src/feature-browser.js',
        'src/feature.js',
        'src/index.js',
        'src/modern.tsx',
        'src/server.js',
        'test/server.test.js'
      ]
    );
    assert(scan.fileTree.every((file) => file.kind && Number.isInteger(file.sizeBytes)));
    assert(scan.fileTree.every((file) => file.contentHash === undefined));
    assert(scan.files.every((file) => typeof file.contentHash === 'string' && file.contentHash.startsWith('sha256:')));
    assert.equal(scan.fileTree.some((file) => file.path === '.env'), false);
    assert.deepEqual(
      scan.imports.map((item) => `${item.path}:${item.source}`).sort(),
      [
        'src/cli.cjs:./cli.ts',
        'src/cli.ts:./index.js',
        'src/index.js:./server.js',
        'src/modern.tsx:./server.js',
        'src/modern.tsx:react',
        'src/server.js:express',
        'test/server.test.js:../src/server.js'
      ]
    );
    assert(scan.symbols.some((symbol) => symbol.path === 'src/server.js' && symbol.name === 'ApiServer'));
    assert(scan.symbols.some((symbol) => symbol.path === 'src/server.js' && symbol.name === 'createServer'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/index.js' && entrypoint.reason === 'package.main'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/cli.ts' && entrypoint.reason === 'package.bin'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/index.js' && entrypoint.reason === 'package.exports[.]'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/cli.ts' && entrypoint.reason === 'package.exports[./cli]'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/cli.cjs' && entrypoint.reason === 'package.exports[./cli]'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/feature.js' && entrypoint.reason === 'package.exports[./feature]'));
    assert(scan.entrypoints.some((entrypoint) => entrypoint.path === 'src/feature-browser.js' && entrypoint.reason === 'package.exports[./feature]'));
    assert(scan.facts.some((fact) => fact.path === 'src/modern.tsx' && fact.kind === 'import' && fact.source === 'react'));
    assert(scan.facts.some((fact) => fact.path === 'src/modern.tsx' && fact.kind === 'export' && fact.source === './server.js'));
    for (const symbol of ['App', 'routeHandler', 'UserRecord', 'UserId', 'Status']) {
      assert(scan.facts.some((fact) => fact.path === 'src/modern.tsx' && fact.kind === 'symbol' && fact.symbol === symbol), `${symbol} fact should be extracted`);
    }
    assert(scan.facts.every((fact) => fact.provenance === 'js-ts-ast'));
    assert.equal(scan.diagnostics.some((diagnostic) => diagnostic.id.startsWith('js-ts-parse-fallback:')), false);
    assert(scan.redactions.some((redaction) => redaction.path === '.env' && redaction.reason === 'secret-bearing-file'));
    assert(scan.redactions.some((redaction) => redaction.path === 'config.json' && redaction.kind === 'secret-value'));
    assert.doesNotMatch(JSON.stringify(scan), /sk-test-1234567890abcdef/);
    assert.doesNotMatch(JSON.stringify(scan), /Ab3dE9fGh2JkL8mNo5PqR7sTu0VxYz12/);
  });

  it('ignores scratch tmp directories during repository scans', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-scratch-ignore-'));
    cleanupTempDir(t, root);
    fs.mkdirSync(path.join(root, 'tmp/scanner-ignore'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(root, 'tmp/scanner-ignore/ignored.js'), 'export function ignored() {}\n');
    fs.writeFileSync(
      path.join(root, 'src/tmp/hidden.js'),
      [
        "const apiKey = 'nested-source-secret';",
        'export function hidden() {',
        '  return apiKey;',
        '}'
      ].join('\n')
    );

    const scan = parseJson(runScript(scanRepo, root));

    assert.doesNotMatch(JSON.stringify(scan), /tmp\/scanner-ignore/);
    assert(scan.files.some((file) => file.path === 'src/tmp/hidden.js'));
    assert(scan.fileTree.some((file) => file.path === 'src/tmp/hidden.js'));
    assert(scan.symbols.some((symbol) => symbol.path === 'src/tmp/hidden.js' && symbol.name === 'hidden'));
    assert(scan.facts.some((fact) => fact.path === 'src/tmp/hidden.js' && fact.kind === 'symbol' && fact.symbol === 'hidden'));
    assert(scan.redactions.some((redaction) => redaction.path === 'src/tmp/hidden.js' && redaction.kind === 'secret-value'));
  });

  it('normalizes scanner output into a deterministic compact evidence bundle with stable ids and provenance', (t) => {
    const root = makeFixtureRepo(t);
    const scanFile = path.join(root, 'scan.json');
    const scanResult = runScript(scanRepo, root, '--output', scanFile);
    assert.equal(scanResult.status, 0, scanResult.stderr || scanResult.stdout);

    const bundle = parseJson(runScript(normalizeEvidence, scanFile));
    assert.deepEqual(Object.keys(bundle), [
      'metadata',
      'fileTree',
      'files',
      'manifests',
      'imports',
      'symbols',
      'entrypoints',
      'facts',
      'redactions',
      'diagnostics'
    ]);
    assert.equal(bundle.metadata.repositoryPath, root);
    assert(bundle.fileTree.every((file) => file.id.startsWith('file-tree:')));
    assert(bundle.files.every((file) => file.id.startsWith('file:')));
    assert(bundle.imports.some((item) => item.id.startsWith('import:src-server-js:express:')));
    assert(bundle.symbols.some((item) => item.id.startsWith('symbol:src-server-js:createServer:')));
    assert(bundle.entrypoints.some((item) => item.id.startsWith('entrypoint:src-index-js:package-main:package-json:')));
    assert(bundle.files.every((file) => typeof file.contentHash === 'string' && file.contentHash.startsWith('sha256:')));
    assert(bundle.fileTree.every((file) => file.contentHash === undefined));
    assert(bundle.facts.some((fact) => fact.id.startsWith('fact:src-modern-tsx:symbol:App:')));
    assert(bundle.facts.every((fact) => fact.evidence.length > 0));
    assert(bundle.files.every((file) => file.provenance?.scanner === 'scan-repo.mjs'));
    assert.deepEqual(
      bundle.files.map((file) => file.id),
      [...bundle.files.map((file) => file.id)].sort()
    );

    const bundleAgain = parseJson(runScript(normalizeEvidence, scanFile));
    assert.deepEqual(bundle, bundleAgain);
  });

  it('reports parser fallback diagnostics for malformed JS/TS files', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-malformed-source-'));
    cleanupTempDir(t, root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(root, 'src/broken.ts'), 'export function broken( {\n');

    const scan = parseJson(runScript(scanRepo, root));

    assert(scan.diagnostics.some((diagnostic) => (
      diagnostic.id === 'js-ts-parse-fallback:src/broken.ts'
      && diagnostic.message === 'Parser extraction failed for src/broken.ts; regex fallback was used.'
    )));
  });

  it('extracts local export declarations as export facts with source and target names', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-local-export-'));
    cleanupTempDir(t, root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(
      path.join(root, 'src/local.ts'),
      [
        'const local = 1;',
        'export { local as renamed };'
      ].join('\n')
    );

    const scan = parseJson(runScript(scanRepo, root));

    assert(scan.facts.some((fact) => (
      fact.path === 'src/local.ts'
      && fact.kind === 'export'
      && fact.source === 'local'
      && fact.target === 'renamed'
      && fact.provenance === 'js-ts-ast'
    )));
  });

  it('keeps redaction ids stable when nearby redactions are added', (t) => {
    const baseScan = {
      metadata: { scanner: 'scan-repo.mjs' },
      redactions: [
        { path: 'src/config.js', line: 7, kind: 'secret-value', reason: 'secret-like-key', name: 'API_TOKEN' },
        { path: 'src/config.js', line: 9, kind: 'high-entropy-token', reason: 'high-entropy-token', length: 32 }
      ]
    };
    const changedScan = {
      metadata: { scanner: 'scan-repo.mjs' },
      redactions: [
        { path: 'src/config.js', line: 5, kind: 'secret-value', reason: 'secret-like-key', name: 'PASSWORD' },
        ...baseScan.redactions
      ]
    };

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-redactions-'));
    cleanupTempDir(t, tempRoot);
    const baseScanPath = path.join(tempRoot, 'base-scan.json');
    const changedScanPath = path.join(tempRoot, 'changed-scan.json');
    fs.writeFileSync(baseScanPath, `${JSON.stringify(baseScan)}\n`);
    fs.writeFileSync(changedScanPath, `${JSON.stringify(changedScan)}\n`);

    const baseBundle = parseJson(runScript(normalizeEvidence, baseScanPath));
    const changedBundle = parseJson(runScript(normalizeEvidence, changedScanPath));
    const baseIds = baseBundle.redactions.map((redaction) => redaction.id).sort();
    const changedIds = changedBundle.redactions
      .filter((redaction) => redaction.name === 'API_TOKEN' || redaction.length === 32)
      .map((redaction) => redaction.id)
      .sort();

    assert.deepEqual(changedIds, baseIds);
  });

  it('keeps normalized path ids unique when slug forms collide', (t) => {
    const scanPath = writeJsonFixture(t, 'architecture-path-collision-', 'scan.json', {
      metadata: { scanner: 'scan-repo.mjs' },
      fileTree: [
        { path: 'src/a-b.js', kind: 'source', sizeBytes: 1 },
        { path: 'src/a/b.js', kind: 'source', sizeBytes: 1 }
      ],
      files: [
        { path: 'src/a-b.js', kind: 'source', sizeBytes: 1 },
        { path: 'src/a/b.js', kind: 'source', sizeBytes: 1 }
      ],
      manifests: [
        { path: 'packages/a-b/package.json', kind: 'package-json', name: 'a-b' },
        { path: 'packages/a/b/package.json', kind: 'package-json', name: 'a-b-nested' }
      ],
      symbols: [
        { path: 'src/a-b.js', name: 'load', kind: 'function', line: 1 },
        { path: 'src/a/b.js', name: 'load', kind: 'function', line: 1 }
      ]
    });

    const bundle = parseJson(runScript(normalizeEvidence, scanPath));
    for (const collectionName of ['fileTree', 'files', 'manifests', 'symbols']) {
      const ids = bundle[collectionName].map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length, `${collectionName} ids should be unique`);
    }
    assert(bundle.files.every((file) => file.id.startsWith('file:src-a-b-js:')));
  });

  it('keeps existing colliding ids stable when another colliding item is added', (t) => {
    const baseScanPath = writeJsonFixture(t, 'architecture-collision-growth-base-', 'scan.json', {
      metadata: { scanner: 'scan-repo.mjs' },
      files: [
        { path: 'src/a-b.js', kind: 'source', sizeBytes: 1 },
        { path: 'src/a/b.js', kind: 'source', sizeBytes: 1 }
      ]
    });
    const changedScanPath = writeJsonFixture(t, 'architecture-collision-growth-changed-', 'scan.json', {
      metadata: { scanner: 'scan-repo.mjs' },
      files: [
        { path: 'src/a b.js', kind: 'source', sizeBytes: 1 },
        { path: 'src/a-b.js', kind: 'source', sizeBytes: 1 },
        { path: 'src/a/b.js', kind: 'source', sizeBytes: 1 }
      ]
    });

    const baseBundle = parseJson(runScript(normalizeEvidence, baseScanPath));
    const changedBundle = parseJson(runScript(normalizeEvidence, changedScanPath));
    const changedIdsByPath = new Map(changedBundle.files.map((file) => [file.path, file.id]));

    for (const file of baseBundle.files) {
      assert.equal(changedIdsByPath.get(file.path), file.id);
    }
  });

  it('keeps duplicate normalized collection ids unique without changing non-colliding ids', (t) => {
    const baseScanPath = writeJsonFixture(t, 'architecture-duplicate-base-', 'scan.json', {
      metadata: { scanner: 'scan-repo.mjs' },
      imports: [
        { path: 'src/a-b.js', source: './dep.js', kind: 'relative' },
        { path: 'src/unique.js', source: './dep.js', kind: 'relative' }
      ],
      entrypoints: [
        { path: 'src/index.js', reason: 'package.main', manifest: 'package.json' }
      ]
    });
    const changedScanPath = writeJsonFixture(t, 'architecture-duplicate-changed-', 'scan.json', {
      metadata: { scanner: 'scan-repo.mjs' },
      imports: [
        { path: 'src/a-b.js', source: './dep.js', kind: 'relative' },
        { path: 'src/a/b.js', source: './dep.js', kind: 'relative' },
        { path: 'src/unique.js', source: './dep.js', kind: 'relative' }
      ],
      entrypoints: [
        { path: 'src/index.js', reason: 'package.main', manifest: 'package.json' },
        { path: 'src/index.js', reason: 'package.main', manifest: 'packages/cli/package.json' }
      ]
    });

    const baseBundle = parseJson(runScript(normalizeEvidence, baseScanPath));
    const changedBundle = parseJson(runScript(normalizeEvidence, changedScanPath));
    const importIds = changedBundle.imports.map((item) => item.id);
    const entrypointIds = changedBundle.entrypoints.map((item) => item.id);

    assert.equal(new Set(importIds).size, importIds.length);
    assert.equal(new Set(entrypointIds).size, entrypointIds.length);
    assert.equal(
      changedBundle.imports.find((item) => item.path === 'src/unique.js').id,
      baseBundle.imports.find((item) => item.path === 'src/unique.js').id
    );
    assert(changedBundle.entrypoints.every((item) => item.id.startsWith('entrypoint:src-index-js:package-main:')));
    assert(changedBundle.entrypoints.some((item) => item.id.includes(':packages-cli-package-json:')));
  });

  it('does not extract imports or symbols from comments and strings', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-masked-source-'));
    cleanupTempDir(t, root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(
      path.join(root, 'src/index.js'),
      [
        "import { real } from './real.js';",
        "// import { commented } from './commented.js';",
        "/* export { blockCommented } from './block-commented.js'; */",
        "const fakeImport = \"require('./string-require.js')\";",
        "const fakeFunction = 'function stringFunction() {}';",
        "const fakeClass = `export class TemplateClass {}`;",
        'export function actualFunction() {',
        '  return real();',
        '}'
      ].join('\n')
    );
    fs.writeFileSync(path.join(root, 'src/real.js'), 'export function real() { return true; }\n');

    const scan = parseJson(runScript(scanRepo, root));

    assert.deepEqual(scan.imports.map((item) => item.source).sort(), ['./real.js']);
    assert(scan.symbols.some((symbol) => symbol.name === 'actualFunction'));
    assert(scan.symbols.some((symbol) => symbol.name === 'real'));
    assert.equal(scan.symbols.some((symbol) => symbol.name === 'stringFunction'), false);
    assert.equal(scan.symbols.some((symbol) => symbol.name === 'TemplateClass'), false);
  });

  it('reports secret-like env and config values without leaking raw values', (t) => {
    const root = makeFixtureRepo(t);
    const result = parseJson(runScript(checkSecrets, root));

    assert(result.findings.some((finding) => finding.path === '.env' && finding.reason === 'secret-bearing-file'));
    assert(result.findings.some((finding) => finding.path === 'config.json' && finding.kind === 'secret-value'));
    assert(result.findings.some((finding) => finding.path === 'config.json' && finding.kind === 'high-entropy-token'));
    assert.doesNotMatch(JSON.stringify(result), /sk-test-1234567890abcdef/);
    assert.doesNotMatch(JSON.stringify(result), /Ab3dE9fGh2JkL8mNo5PqR7sTu0VxYz12/);
  });

  it('runs the scanner on the scryfall-mcp fixture repo without external services', { skip: !fs.existsSync(fixtureRepo) }, () => {
    const scan = parseJson(runScript(scanRepo, fixtureRepo));

    assert(scan.files.length > 0);
    assert(scan.manifests.some((manifest) => manifest.path === 'package.json'));
    assert.equal(scan.diagnostics.some((diagnostic) => /external service/i.test(diagnostic.message)), false);
  });
});
