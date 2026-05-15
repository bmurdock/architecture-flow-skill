import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, '.agents/skills/architecture-flows');
const planner = path.join(skillRoot, 'scripts/plan-incremental.mjs');
const schema = path.join(skillRoot, 'references/architecture-flows.schema.json');

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function runPlanner(...args) {
  return spawnSync(process.execPath, [planner, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-incremental-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"incremental-fixture","main":"src/server.js"}\n');
  fs.writeFileSync(path.join(root, 'src/server.js'), "import { buildGreeting } from './handler.js';\nexport function startServer(name) { return buildGreeting(name); }\n");
  fs.writeFileSync(path.join(root, 'src/handler.js'), "export function buildGreeting(name) { return `Hello ${name}`; }\n");

  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
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

function commitAll(repoPath, message) {
  spawnSync('git', ['add', '.'], { cwd: repoPath, encoding: 'utf8' });
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: repoPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function artifactFor(repoPath, overrides = {}) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).stdout.trim();
  const serverText = fs.readFileSync(path.join(repoPath, 'src/server.js'), 'utf8');
  const handlerText = fs.readFileSync(path.join(repoPath, 'src/handler.js'), 'utf8');

  return {
    schemaVersion: '0.1.0',
    metadata: {
      repository: 'incremental-fixture',
      branch: 'main',
      commit,
      sourceCommit: commit,
      generatedAt: '2026-05-14T12:00:00.000Z',
      generationMode: 'codex-session',
      incrementalMode: 'full',
      schemaVersion: '0.1.0',
      extractorVersions: {
        'scan-repo.mjs': 'sha256:test-version'
      },
      artifactHash: 'sha256:previous',
      parentArtifactHash: null,
      privacy: 'local-only',
      ...overrides.metadata
    },
    evidence: [
      {
        id: 'ev:src/server.js#startServer',
        kind: 'symbol',
        path: 'src/server.js',
        symbol: 'startServer',
        language: 'javascript',
        provenance: 'fixture',
        reason: 'Defines the request entrypoint.',
        contentHash: sha256(serverText)
      },
      {
        id: 'ev:src/handler.js#buildGreeting',
        kind: 'symbol',
        path: 'src/handler.js',
        symbol: 'buildGreeting',
        language: 'javascript',
        provenance: 'fixture',
        reason: 'Defines the greeting builder.',
        contentHash: sha256(handlerText)
      }
    ],
    nodes: [
      {
        id: 'node:start-server',
        kind: 'function',
        label: 'startServer',
        evidence: ['ev:src/server.js#startServer'],
        confidence: { overall: 'high' },
        reviewNotes: 'Keep this user note.'
      },
      {
        id: 'node:build-greeting',
        kind: 'function',
        label: 'buildGreeting',
        evidence: ['ev:src/handler.js#buildGreeting'],
        confidence: { overall: 'high' },
        humanOverride: 'Unknown curated field must be rejected.'
      }
    ],
    edges: [
      {
        id: 'edge:start-to-build',
        kind: 'calls',
        from: 'node:start-server',
        to: 'node:build-greeting',
        evidence: ['ev:src/server.js#startServer', 'ev:src/handler.js#buildGreeting'],
        confidence: { overall: 'high' }
      }
    ],
    flows: [
      {
        id: 'flow:greeting',
        name: 'Greeting request',
        summary: 'A request returns a greeting.',
        trigger: 'Request',
        entry: 'node:start-server',
        exit: 'node:build-greeting',
        steps: [
          {
            id: 'step:receive',
            order: 1,
            node: 'node:start-server',
            edge: 'edge:start-to-build',
            description: 'Call the handler.',
            evidence: ['ev:src/server.js#startServer'],
            confidence: { overall: 'high' }
          },
          {
            id: 'step:return',
            order: 2,
            node: 'node:build-greeting',
            description: 'Return the greeting.',
            evidence: ['ev:src/handler.js#buildGreeting'],
            confidence: { overall: 'high' }
          }
        ]
      }
    ],
    diagnostics: []
  };
}

function writeArtifact(t, repoPath, artifact) {
  const artifactPath = path.join(repoPath, 'architecture-flows.json');
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactPath;
}

describe('plan-incremental.mjs', () => {
  it('reports a stable no-op plan for the same commit and unchanged evidence', (t) => {
    const root = makeRepo(t);
    const artifactPath = writeArtifact(t, root, artifactFor(root));

    const first = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');
    const second = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
    assert.equal(JSON.parse(first.stdout).regenerationRequired, true);
    assert.deepEqual(JSON.parse(first.stdout).changes.changedEvidence, []);
    assert.match(first.stdout, /extractor-version-changed/);
  });

  it('identifies impacted nodes, edges, and flows from changed evidence paths', (t) => {
    const root = makeRepo(t);
    const artifactPath = writeArtifact(t, root, artifactFor(root));
    fs.writeFileSync(path.join(root, 'src/handler.js'), "export function buildGreeting(name) { return `Hi ${name}`; }\n");

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.changes.changedEvidence.map((item) => item.id), ['ev:src/handler.js#buildGreeting']);
    assert.deepEqual(plan.impacted.nodes, ['node:build-greeting']);
    assert.deepEqual(plan.impacted.edges, ['edge:start-to-build']);
    assert.deepEqual(plan.impacted.flows, ['flow:greeting']);
    assert.deepEqual(plan.impacted.steps, ['step:receive', 'step:return']);
    assert.deepEqual(plan.curatedFields.preserve.map((item) => item.path), ['nodes[0].reviewNotes']);
    assert.deepEqual(plan.curatedFields.reject.map((item) => item.path), ['nodes[1].humanOverride']);
  });

  it('validates and verifies in verify-only mode without writing a plan by default', (t) => {
    const root = makeRepo(t);
    const artifactPath = writeArtifact(t, root, artifactFor(root));
    const outputPath = path.join(root, 'incremental-plan.json');

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'verify-only');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.mode, 'verify-only');
    assert.equal(plan.validation.valid, true);
    assert.equal(plan.verification.ok, true);
    assert.equal(fs.existsSync(outputPath), false);
  });

  it('diagnoses missing Phase 6 metadata while still outputting complete nextMetadata', (t) => {
    const root = makeRepo(t);
    const artifact = artifactFor(root);
    delete artifact.metadata.sourceCommit;
    delete artifact.metadata.incrementalMode;
    delete artifact.metadata.schemaVersion;
    delete artifact.metadata.extractorVersions;
    delete artifact.metadata.artifactHash;
    delete artifact.metadata.parentArtifactHash;
    const artifactPath = writeArtifact(t, root, artifact);

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(
      plan.diagnostics
        .filter((diagnostic) => diagnostic.code === 'missing-incremental-metadata')
        .map((diagnostic) => diagnostic.field),
      [
        'metadata.artifactHash',
        'metadata.extractorVersions',
        'metadata.incrementalMode',
        'metadata.parentArtifactHash',
        'metadata.schemaVersion',
        'metadata.sourceCommit'
      ]
    );
    assert.match(plan.nextMetadata.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(plan.nextMetadata.schemaVersion, '0.1.0');
    assert.equal(plan.nextMetadata.artifactHash, undefined);
    assert.match(plan.currentArtifactHash, /^sha256:/);
    assert.equal(plan.parentArtifactHashForNext, plan.currentArtifactHash);
    assert.equal(plan.nextMetadata.parentArtifactHash, plan.currentArtifactHash);
    assert.equal(plan.nextMetadata.incrementalMode, 'delta');
    assert.equal(typeof plan.nextMetadata.extractorVersions['plan-incremental.mjs'], 'string');
  });

  it('detects committed changes since the artifact source commit', (t) => {
    const root = makeRepo(t);
    const artifact = artifactFor(root);
    const artifactPath = writeArtifact(t, root, artifact);
    fs.writeFileSync(path.join(root, 'src/handler.js'), "export function buildGreeting(name) { return `Hola ${name}`; }\n");
    commitAll(root, 'change handler after artifact');

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert(plan.changes.gitChangedFiles.some((item) => item.path === 'src/handler.js' && item.source === 'commit-diff'));
    assert.deepEqual(plan.changes.changedEvidence.map((item) => item.id), ['ev:src/handler.js#buildGreeting']);
    assert(plan.changes.changedEvidence[0].reasons.includes('git-commit-changed'));
    assert.deepEqual(plan.impacted.nodes, ['node:build-greeting']);
  });

  it('requires discovery when a newly committed source file is not represented by existing evidence', (t) => {
    const root = makeRepo(t);
    const artifact = artifactFor(root);
    const artifactPath = writeArtifact(t, root, artifact);
    fs.writeFileSync(path.join(root, 'src/new-tool.js'), 'export function newTool() { return true; }\n');
    commitAll(root, 'add new source file after artifact');

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.regenerationRequired, true);
    assert(plan.reasons.includes('unmapped-source-changed'));
    assert.deepEqual(plan.changes.unmappedChangedFiles, [
      {
        path: 'src/new-tool.js',
        status: 'A',
        source: 'commit-diff',
        reason: 'source-file-not-in-evidence'
      }
    ]);
    assert.equal(plan.requiresDiscovery, true);
  });

  it('requires discovery when an untracked source file is not represented by existing evidence', (t) => {
    const root = makeRepo(t);
    const artifactPath = writeArtifact(t, root, artifactFor(root));
    fs.writeFileSync(path.join(root, 'src/local-experiment.ts'), 'export const localExperiment = true;\n');

    const result = runPlanner('--repo', root, '--artifact', artifactPath, '--mode', 'delta');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.regenerationRequired, true);
    assert(plan.reasons.includes('unmapped-source-changed'));
    assert.deepEqual(plan.changes.unmappedChangedFiles, [
      {
        path: 'src/local-experiment.ts',
        status: '??',
        source: 'dirty-status',
        reason: 'source-file-not-in-evidence'
      }
    ]);
    assert.equal(plan.requiresDiscovery, true);
  });

  it('allows full, delta, and verify-only metadata modes in the schema', () => {
    const parsed = JSON.parse(fs.readFileSync(schema, 'utf8'));

    assert.deepEqual(parsed.properties.metadata.properties.incrementalMode.enum, ['full', 'delta', 'verify-only']);
  });
});
