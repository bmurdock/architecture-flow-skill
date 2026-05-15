import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
});
