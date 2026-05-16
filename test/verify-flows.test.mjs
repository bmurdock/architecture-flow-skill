import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(repoRoot, '.agents/skills/architecture-flows/scripts/verify-flows.mjs');
const fixture = (...parts) =>
  path.join(repoRoot, '.agents/skills/architecture-flows/fixtures', ...parts);

function runVerifier(...args) {
  return spawnSync(process.execPath, [verifier, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixtureWithHeadCommit(fixturePath, { patchPackageHash = true } = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
  const artifactPath = path.join(tempDir, 'architecture-flows.json');
  const artifact = JSON.parse(readFileSync(fixturePath, 'utf8'));
  artifact.metadata.commit = currentCommit();
  if (patchPackageHash) {
    for (const evidence of artifact.evidence ?? []) {
      if (evidence?.path === 'package.json') {
        evidence.contentHash = sha256File(path.join(repoRoot, 'package.json'));
      }
    }
  }
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return { tempDir, artifactPath };
}

describe('verify-flows.mjs', () => {
  it('accepts evidence-backed artifacts and reports visible nonblocking warnings', () => {
    const result = runVerifier(fixture('valid/minimal-flow.json'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /verified with warnings/i);
    assert.match(result.stdout, /repository context not supplied/i);
  });

  it('rejects unsupported and overclaimed semantic claims', () => {
    const result = runVerifier(fixture('invalid/unsupported-claims.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generic evidence id "ev:unknown"/);
    assert.match(result.stderr, /uses inference wording with high confidence/);
    assert.match(result.stderr, /diagnostics\[0\] has error severity/);
  });

  it('rejects broken graph references without relying on schema validation', () => {
    const brokenNodes = runVerifier(fixture('invalid/broken-references.json'));
    const brokenEdge = runVerifier(fixture('invalid/broken-step-edge.json'));

    assert.notEqual(brokenNodes.status, 0);
    assert.match(brokenNodes.stderr, /Unknown node reference "node:missing" at edges\[0\]\.to/);
    assert.match(brokenNodes.stderr, /Unknown node reference "node:missing" at flows\[0\]\.entry/);
    assert.match(brokenNodes.stderr, /Unknown node reference "node:missing" at flows\[0\]\.steps\[0\]\.node/);

    assert.notEqual(brokenEdge.status, 0);
    assert.match(brokenEdge.stderr, /Unknown edge reference "edge:missing" at flows\[0\]\.steps\[0\]\.edge/);
  });

  it('rejects high-confidence claims backed only by weak path evidence', () => {
    const result = runVerifier(fixture('invalid/weak-high-confidence-evidence.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nodes\[0\] uses high confidence without strong direct evidence/);
    assert.match(result.stderr, /edges\[0\] uses high confidence without strong direct evidence/);
    assert.match(result.stderr, /flows\[0\]\.steps\[0\] uses high confidence without strong direct evidence/);
  });

  it('rejects high-confidence node extra claim fields with inference wording', () => {
    const result = runVerifier(fixture('invalid/inferred-node-extra-field.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nodes\[0\] uses inference wording with high confidence/);
  });

  it('rejects nested extra claim fields with inference wording', () => {
    const result = runVerifier(fixture('invalid/inferred-nested-extra-fields.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nodes\[0\] uses inference wording with high confidence/);
    assert.match(result.stderr, /edges\[0\] uses inference wording with high confidence/);
    assert.match(result.stderr, /flows\[0\]\.steps\[0\] uses inference wording with high confidence/);
  });

  it('does not treat structural evidence ids as semantic inference wording', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: 'unknown',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:src/inference.ts#registerRoutes',
                kind: 'symbol',
                path: 'src/inference.ts',
                symbol: 'registerRoutes',
                provenance: 'typescript-ast',
                reason: 'Registers routes.'
              }
            ],
            nodes: [
              {
                id: 'node:routes',
                kind: 'module',
                label: 'Routes',
                evidence: ['ev:src/inference.ts#registerRoutes'],
                confidence: { overall: 'high' }
              }
            ],
            edges: [
              {
                id: 'edge:routes-self',
                kind: 'registers',
                from: 'node:routes',
                to: 'node:routes',
                evidence: ['ev:src/inference.ts#registerRoutes'],
                confidence: { overall: 'high' }
              }
            ],
            flows: [
              {
                id: 'flow:routes',
                name: 'Routes',
                summary: 'Routes are registered.',
                trigger: 'Startup',
                steps: [
                  {
                    id: 'step:routes',
                    order: 1,
                    node: 'node:routes',
                    edge: 'edge:routes-self',
                    description: 'Register routes.',
                    evidence: ['ev:src/inference.ts#registerRoutes'],
                    confidence: { overall: 'high' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier(artifactPath);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.doesNotMatch(result.stderr, /uses inference wording with high confidence/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('allows inferred claims when confidence is downgraded and uncertainty is explicit', () => {
    const result = runVerifier(fixture('valid/inferred-with-uncertainty.json'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /uses inference wording with high confidence/);
  });

  it('rejects medium-confidence relationship claims with indirect wording but no uncertainty', () => {
    const result = runVerifier(fixture('invalid/inferred-relationship-without-uncertainty.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /edges\[0\] uses indirect or inference wording without uncertaintyReason/);
    assert.match(result.stderr, /flows\[0\]\.steps\[0\] uses indirect or inference wording without uncertaintyReason/);
  });

  it('rejects stale evidence hashes when repository context is supplied', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      writeFileSync(path.join(tempRepo, 'server.ts'), 'export function startServer() {}\n');
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: 'unknown',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:server.ts#startServer',
                kind: 'symbol',
                path: 'server.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                reason: 'Defines the server entrypoint.',
                contentHash: sha256('stale content\n')
              }
            ],
            nodes: [
              {
                id: 'node:server',
                kind: 'function',
                label: 'startServer',
                evidence: ['ev:server.ts#startServer'],
                confidence: { overall: 'high' }
              }
            ],
            edges: [],
            flows: [
              {
                id: 'flow:start',
                name: 'Start',
                summary: 'Start the server.',
                trigger: 'Process startup',
                steps: [
                  {
                    id: 'step:start',
                    order: 1,
                    node: 'node:server',
                    description: 'Run startServer.',
                    evidence: ['ev:server.ts#startServer'],
                    confidence: { overall: 'high' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier('--repo', tempRepo, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /contentHash does not match current file/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('warns when repository context has no verifiable commit or evidence hashes', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      writeFileSync(path.join(tempRepo, 'server.ts'), 'export function startServer() {}\n');
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: 'unknown',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:server.ts#startServer',
                kind: 'symbol',
                path: 'server.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                reason: 'Defines the server entrypoint.'
              }
            ],
            nodes: [
              {
                id: 'node:server',
                kind: 'function',
                label: 'startServer',
                evidence: ['ev:server.ts#startServer'],
                confidence: { overall: 'high' }
              }
            ],
            edges: [],
            flows: [
              {
                id: 'flow:start',
                name: 'Start',
                summary: 'Start the server.',
                trigger: 'Process startup',
                steps: [
                  {
                    id: 'step:start',
                    order: 1,
                    node: 'node:server',
                    description: 'Run startServer.',
                    evidence: ['ev:server.ts#startServer'],
                    confidence: { overall: 'high' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier('--repo', tempRepo, artifactPath);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /verified with warnings/i);
      assert.match(result.stdout, /metadata\.commit is not a verifiable 40-character git hash/);
      assert.match(result.stdout, /no evidence records include contentHash/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('warns about missing evidence paths without hashes when repository context is supplied', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: 'unknown',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:missing.ts',
                kind: 'symbol',
                path: 'missing.ts',
                symbol: 'missing',
                provenance: 'typescript-ast',
                reason: 'Defines a missing source symbol.'
              }
            ],
            nodes: [
              {
                id: 'node:missing',
                kind: 'function',
                label: 'missing',
                evidence: ['ev:missing.ts'],
                confidence: { overall: 'high' }
              }
            ],
            edges: [],
            flows: [
              {
                id: 'flow:missing',
                name: 'Missing',
                summary: 'Read the missing source.',
                trigger: 'Verification',
                steps: [
                  {
                    id: 'step:missing',
                    order: 1,
                    node: 'node:missing',
                    description: 'Read missing.',
                    evidence: ['ev:missing.ts'],
                    confidence: { overall: 'high' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier('--repo', tempRepo, artifactPath);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /evidence\[0\] ev:missing\.ts path not found in repository context/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('strict mode passes for fact-derived fresh evidence', () => {
    const { tempDir, artifactPath } = fixtureWithHeadCommit(fixture('valid/strict-facts-flow.json'));
    try {
      const result = runVerifier('--strict', '--repo', repoRoot, artifactPath);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /verified$/m);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('strict mode fails when repository HEAD is unavailable', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      const sourcePath = path.join(tempRepo, 'source.ts');
      writeFileSync(sourcePath, 'export function startServer() {}\n');
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: '0123456789abcdef0123456789abcdef01234567',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:source.ts#startServer',
                kind: 'symbol',
                path: 'source.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                reason: 'Defines the server entrypoint.',
                contentHash: sha256('export function startServer() {}\n')
              }
            ],
            facts: [
              {
                id: 'fact:server-entrypoint',
                kind: 'entrypoint',
                path: 'source.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                evidence: ['ev:source.ts#startServer']
              }
            ],
            nodes: [
              {
                id: 'node:server',
                kind: 'function',
                label: 'startServer',
                derivedFrom: ['fact:server-entrypoint'],
                evidence: ['ev:source.ts#startServer'],
                confidence: { overall: 'high' }
              }
            ],
            edges: [],
            flows: [
              {
                id: 'flow:start',
                name: 'Start',
                summary: 'Start the server.',
                trigger: 'Process startup',
                steps: [
                  {
                    id: 'step:start',
                    order: 1,
                    node: 'node:server',
                    derivedFrom: ['fact:server-entrypoint'],
                    description: 'Run startServer.',
                    evidence: ['ev:source.ts#startServer'],
                    confidence: { overall: 'high' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier('--strict', '--repo', tempRepo, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /metadata\.commit could not be verified because repository HEAD is unavailable/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('strict mode requires derivedFrom fact references', () => {
    const { tempDir, artifactPath } = fixtureWithHeadCommit(fixture('invalid/strict-missing-derived-from.json'));
    try {
      const result = runVerifier('--strict', '--repo', repoRoot, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /nodes\[0\] references missing fact "fact:missing" in derivedFrom/);
      assert.match(result.stderr, /flows\[0\]\.steps\[0\] must include derivedFrom in strict mode/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects facts that reference missing evidence', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'architecture-flow-verify-'));
    try {
      const artifactPath = path.join(tempRepo, 'architecture-flows.json');
      writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: '0.1.0',
            metadata: {
              repository: 'fixture',
              branch: 'main',
              commit: 'unknown',
              generatedAt: '2026-05-14T12:00:00.000Z',
              generationMode: 'codex-session',
              privacy: 'local-only'
            },
            evidence: [
              {
                id: 'ev:source.ts#startServer',
                kind: 'symbol',
                path: 'source.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                reason: 'Defines the server entrypoint.'
              }
            ],
            facts: [
              {
                id: 'fact:server-entrypoint',
                kind: 'entrypoint',
                path: 'source.ts',
                symbol: 'startServer',
                provenance: 'typescript-ast',
                evidence: ['ev:missing']
              }
            ],
            nodes: [
              {
                id: 'node:server',
                kind: 'function',
                label: 'startServer',
                evidence: ['ev:source.ts#startServer'],
                confidence: { overall: 'medium' }
              }
            ],
            edges: [],
            flows: [
              {
                id: 'flow:start',
                name: 'Start',
                summary: 'Start the server.',
                trigger: 'Process startup',
                steps: [
                  {
                    id: 'step:start',
                    order: 1,
                    node: 'node:server',
                    description: 'Run startServer.',
                    evidence: ['ev:source.ts#startServer'],
                    confidence: { overall: 'medium' }
                  }
                ]
              }
            ]
          },
          null,
          2
        )
      );

      const result = runVerifier(artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /facts\[0\] references missing evidence "ev:missing"/);
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('strict mode requires content hashes when repo context is supplied', () => {
    const { tempDir, artifactPath } = fixtureWithHeadCommit(fixture('invalid/strict-missing-content-hash.json'), {
      patchPackageHash: false
    });
    try {
      const result = runVerifier('--strict', '--repo', repoRoot, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /evidence\[0\] ev:package\.json must include sha256 contentHash in strict mode/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('strict mode rejects hash-bearing evidence without a path', () => {
    const { tempDir, artifactPath } = fixtureWithHeadCommit(fixture('valid/strict-facts-flow.json'));
    try {
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      delete artifact.evidence[0].path;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

      const result = runVerifier('--strict', '--repo', repoRoot, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /evidence\[0\] ev:package\.json must include evidence\.path in strict mode/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('strict mode should fail without --repo because freshness cannot be checked', () => {
    const result = runVerifier('--strict', fixture('valid/strict-facts-flow.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repository context not supplied; stale evidence checks limited to artifact structure/);
  });

  it('non-strict minimal fixture behavior remains pass-with-warnings', () => {
    const result = runVerifier(fixture('valid/minimal-flow.json'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /verified with warnings/i);
    assert.match(result.stdout, /repository context not supplied/i);
  });

  it('strict mode promotes missing evidence paths to errors', () => {
    const { tempDir, artifactPath } = fixtureWithHeadCommit(fixture('invalid/strict-missing-evidence-path.json'));
    try {
      const result = runVerifier('--strict', '--repo', repoRoot, artifactPath);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /evidence\[0\] ev:missing\.ts path not found in repository context/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects unknown CLI options', () => {
    const result = runVerifier('--wat', fixture('valid/minimal-flow.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: verify-flows\.mjs/);
  });

  it('rejects --repo without a path value', () => {
    const result = runVerifier('--repo', '--strict', fixture('valid/minimal-flow.json'));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: verify-flows\.mjs/);
  });
});
