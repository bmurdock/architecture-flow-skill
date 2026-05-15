#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modes = new Set(['full', 'delta', 'verify-only']);
const preservedCuratedFields = new Set(['reviewNotes', 'humanNotes', 'curatedNotes', 'curatedLabel', 'curatedDescription', 'xCurated']);
const curatedFieldPattern = /(curated|human|review)/i;
const relevantChangedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.toml']);
const relevantChangedBasenames = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  'eslint.config.js'
]);
const requiredIncrementalMetadataFields = [
  'artifactHash',
  'extractorVersions',
  'incrementalMode',
  'parentArtifactHash',
  'schemaVersion',
  'sourceCommit'
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const schemaPath = path.join(skillRoot, 'references/architecture-flows.schema.json');
const extractorScripts = [
  'scan-repo.mjs',
  'normalize-evidence.mjs',
  'validate-flows.mjs',
  'verify-flows.mjs',
  'plan-incremental.mjs'
];

function usage(exitCode = 2) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write('Usage: plan-incremental.mjs --repo <path> --artifact <architecture-flows.json> --mode <full|delta|verify-only> [--output plan.json]\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    artifact: null,
    mode: 'delta',
    output: null,
    repo: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage(0);
    }
    if (arg === '--artifact') {
      options.artifact = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--mode') {
      options.mode = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      options.output = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      options.repo = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    usage(2);
  }

  if (!options.repo || !options.artifact || !modes.has(options.mode)) {
    usage(2);
  }

  return {
    artifactPath: path.resolve(options.artifact),
    mode: options.mode,
    outputPath: options.output ? path.resolve(options.output) : null,
    repoPath: path.resolve(options.repo)
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function artifactForHash(artifact) {
  const clone = structuredClone(artifact);
  if (isObject(clone.metadata)) {
    delete clone.metadata.artifactHash;
    delete clone.metadata.parentArtifactHash;
    delete clone.metadata.generatedAt;
  }
  return clone;
}

function stableArtifactHash(artifact) {
  return sha256(JSON.stringify(canonicalize(artifactForHash(artifact))));
}

function runGit(repoPath, args) {
  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function gitMetadata(repoPath) {
  return {
    branch: runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    commit: runGit(repoPath, ['rev-parse', 'HEAD']) ?? 'unknown'
  };
}

function parseNameStatus(output, source) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [statusCode, ...paths] = line.split('\t');
      return {
        path: paths.at(-1),
        status: statusCode,
        source
      };
    })
    .filter((item) => item.path);
}

function parseDirtyStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const statusCode = line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = line.slice(2).trimStart();
      const renameParts = rawPath.split(' -> ');
      return {
        path: renameParts.at(-1),
        status: statusCode,
        source: 'dirty-status'
      };
    });
}

function validCommit(value) {
  return /^[a-f0-9]{40}$/i.test(value ?? '');
}

function commitExists(repoPath, commit) {
  if (!validCommit(commit)) {
    return false;
  }
  const result = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
    cwd: repoPath,
    encoding: 'utf8'
  });
  return result.status === 0;
}

function gitChangedFiles(repoPath, artifactCommit) {
  const changedFiles = [];
  if (commitExists(repoPath, artifactCommit)) {
    const diff = runGit(repoPath, ['diff', '--name-status', `${artifactCommit}..HEAD`]);
    if (diff) {
      changedFiles.push(...parseNameStatus(diff, 'commit-diff'));
    }
  }

  const status = runGit(repoPath, ['status', '--porcelain']);
  if (status) {
    changedFiles.push(...parseDirtyStatus(status));
  }

  const seen = new Set();
  return changedFiles
    .filter((item) => {
      const key = `${item.source}:${item.status}:${item.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.path}:${a.status}`.localeCompare(`${b.path}:${b.status}`));
}

function currentExtractorVersions() {
  return Object.fromEntries(extractorScripts.map((scriptName) => {
    const scriptPath = path.join(scriptDir, scriptName);
    return [scriptName, fs.existsSync(scriptPath) ? sha256File(scriptPath) : 'missing'];
  }));
}

function compareExtractorVersions(previousVersions, currentVersions) {
  const previous = isObject(previousVersions) ? previousVersions : {};
  return Object.keys(currentVersions)
    .filter((key) => previous[key] !== currentVersions[key])
    .sort()
    .map((key) => ({
      name: key,
      previous: previous[key] ?? null,
      current: currentVersions[key]
    }));
}

function detectChangedEvidence(repoPath, artifact, changedFiles) {
  const gitChangedPaths = new Map();
  for (const item of changedFiles) {
    const sources = gitChangedPaths.get(item.path) ?? new Set();
    sources.add(item.source);
    gitChangedPaths.set(item.path, sources);
  }
  const changes = [];

  for (const evidence of asArray(artifact.evidence)) {
    if (!isObject(evidence) || typeof evidence.path !== 'string') {
      continue;
    }

    const evidencePath = path.resolve(repoPath, evidence.path);
    const reasons = [];
    let currentHash = null;
    if (!evidencePath.startsWith(`${repoPath}${path.sep}`) && evidencePath !== repoPath) {
      reasons.push('path-escapes-repo');
    } else if (!fs.existsSync(evidencePath)) {
      reasons.push('missing-file');
    } else {
      currentHash = sha256File(evidencePath);
      if (typeof evidence.contentHash === 'string' && evidence.contentHash !== currentHash) {
        reasons.push('content-hash-changed');
      }
    }

    if (gitChangedPaths.get(evidence.path)?.has('dirty-status')) {
      reasons.push('git-status-changed');
    }
    if (gitChangedPaths.get(evidence.path)?.has('commit-diff')) {
      reasons.push('git-commit-changed');
    }

    if (reasons.length > 0) {
      changes.push({
        id: evidence.id ?? null,
        path: evidence.path,
        previousHash: evidence.contentHash ?? null,
        currentHash,
        reasons: [...new Set(reasons)].sort()
      });
    }
  }

  return changes.sort((a, b) => `${a.path}:${a.id}`.localeCompare(`${b.path}:${b.id}`));
}

function isRelevantChangedPath(filePath) {
  const base = path.posix.basename(filePath);
  return relevantChangedBasenames.has(base) || relevantChangedExtensions.has(path.posix.extname(filePath));
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function detectUnmappedChangedFiles(repoPath, artifactPath, artifact, changedFiles) {
  const artifactRelativePath = toPosixPath(path.relative(repoPath, artifactPath));
  const evidencePaths = new Set(
    asArray(artifact.evidence)
      .map((evidence) => evidence?.path)
      .filter((filePath) => typeof filePath === 'string')
  );
  const seen = new Set();

  return changedFiles
    .filter((item) => item.path && item.path !== artifactRelativePath && isRelevantChangedPath(item.path) && !evidencePaths.has(item.path))
    .map((item) => ({
      path: item.path,
      status: item.status,
      source: item.source,
      reason: 'source-file-not-in-evidence'
    }))
    .filter((item) => {
      const key = `${item.source}:${item.status}:${item.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.path}:${a.status}:${a.source}`.localeCompare(`${b.path}:${b.status}:${b.source}`));
}

function artifactSourceCommit(artifact) {
  const sourceCommit = artifact.metadata?.sourceCommit;
  if (validCommit(sourceCommit)) {
    return sourceCommit;
  }
  const commit = artifact.metadata?.commit;
  return validCommit(commit) ? commit : null;
}

function incrementalMetadataDiagnostics(artifact, mode) {
  if (!modes.has(mode)) {
    return [];
  }

  const metadata = isObject(artifact.metadata) ? artifact.metadata : {};
  return requiredIncrementalMetadataFields
    .filter((field) => !hasOwn(metadata, field))
    .sort()
    .map((field) => ({
      code: 'missing-incremental-metadata',
      severity: 'warning',
      field: `metadata.${field}`,
      message: `Artifact is missing metadata.${field}; incremental ${mode} planning will provide it in nextMetadata.`
    }));
}

function intersects(left, right) {
  return asArray(left).some((value) => right.has(value));
}

function impactedSubgraph(artifact, changedEvidence) {
  const changedEvidenceIds = new Set(changedEvidence.map((item) => item.id).filter(Boolean));
  const nodeIds = new Set();
  const edgeIds = new Set();
  const flowIds = new Set();
  const stepIds = new Set();

  for (const node of asArray(artifact.nodes)) {
    if (intersects(node?.evidence, changedEvidenceIds)) {
      nodeIds.add(node.id);
    }
  }

  for (const edge of asArray(artifact.edges)) {
    if (intersects(edge?.evidence, changedEvidenceIds) || nodeIds.has(edge?.from) || nodeIds.has(edge?.to)) {
      edgeIds.add(edge.id);
    }
  }

  for (const flow of asArray(artifact.flows)) {
    let flowImpacted = nodeIds.has(flow?.entry) || nodeIds.has(flow?.exit);
    for (const step of asArray(flow?.steps)) {
      if (intersects(step?.evidence, changedEvidenceIds) || nodeIds.has(step?.node) || edgeIds.has(step?.edge)) {
        stepIds.add(step.id);
        flowImpacted = true;
      }
    }
    if (flowImpacted) {
      flowIds.add(flow.id);
    }
  }

  return {
    evidence: [...changedEvidenceIds].sort(),
    nodes: [...nodeIds].sort(),
    edges: [...edgeIds].sort(),
    flows: [...flowIds].sort(),
    steps: [...stepIds].sort()
  };
}

function collectCuratedFields(artifact) {
  const preserve = [];
  const reject = [];

  function visit(value, context) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${context}[${index}]`));
      return;
    }
    if (!isObject(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = context ? `${context}.${key}` : key;
      if (preservedCuratedFields.has(key)) {
        preserve.push({
          path: childPath,
          policy: 'preserve-in-plan',
          value: child
        });
      } else if (curatedFieldPattern.test(key)) {
        reject.push({
          path: childPath,
          policy: 'reject-unknown-curated-field',
          reason: `Field "${key}" is not in the conservative preservation allowlist.`
        });
      }
      visit(child, childPath);
    }
  }

  visit(artifact, '');
  return {
    preserve: preserve.sort((a, b) => a.path.localeCompare(b.path)),
    reject: reject.sort((a, b) => a.path.localeCompare(b.path))
  };
}

function runCheck(scriptName, args) {
  const scriptPath = path.join(scriptDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: skillRoot,
    encoding: 'utf8'
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function buildPlan({ artifact, artifactPath, mode, repoPath }) {
  const git = gitMetadata(repoPath);
  const changedFiles = gitChangedFiles(repoPath, artifactSourceCommit(artifact));
  const changedEvidence = detectChangedEvidence(repoPath, artifact, changedFiles);
  const unmappedChangedFiles = detectUnmappedChangedFiles(repoPath, artifactPath, artifact, changedFiles);
  const extractorVersions = currentExtractorVersions();
  const extractorChanges = compareExtractorVersions(artifact.metadata?.extractorVersions, extractorVersions);
  const schemaVersionChanged = artifact.metadata?.schemaVersion && artifact.metadata.schemaVersion !== artifact.schemaVersion;
  const reasons = [];
  const currentArtifactHash = stableArtifactHash(artifact);

  if (mode === 'full') {
    reasons.push('full-mode-requested');
  }
  if (changedEvidence.length > 0) {
    reasons.push('evidence-changed');
  }
  if (unmappedChangedFiles.length > 0) {
    reasons.push('unmapped-source-changed');
  }
  if (extractorChanges.length > 0) {
    reasons.push('extractor-version-changed');
  }
  if (schemaVersionChanged) {
    reasons.push('schema-version-changed');
  }

  const validation = runCheck('validate-flows.mjs', [artifactPath]);
  const verification = mode === 'verify-only' ? runCheck('verify-flows.mjs', ['--repo', repoPath, artifactPath]) : null;

  return {
    mode,
    currentArtifactHash,
    parentArtifactHashForNext: currentArtifactHash,
    artifact: {
      path: artifactPath,
      hash: currentArtifactHash,
      parentArtifactHash: artifact.metadata?.artifactHash ?? null,
      schemaVersion: artifact.schemaVersion ?? null,
      metadataSchemaVersion: artifact.metadata?.schemaVersion ?? null,
      sourceCommit: artifact.metadata?.sourceCommit ?? artifact.metadata?.commit ?? null
    },
    nextMetadata: {
      schemaVersion: artifact.schemaVersion ?? null,
      commit: git.commit,
      sourceCommit: git.commit,
      sourceBranch: git.branch,
      generationMode: artifact.metadata?.generationMode ?? 'codex-session',
      incrementalMode: mode,
      parentArtifactHash: currentArtifactHash,
      extractorVersions
    },
    regenerationRequired: reasons.length > 0,
    reasons,
    requiresDiscovery: unmappedChangedFiles.length > 0,
    diagnostics: incrementalMetadataDiagnostics(artifact, mode),
    changes: {
      gitChangedFiles: changedFiles,
      changedEvidence,
      unmappedChangedFiles,
      extractorChanges,
      schemaVersionChanged: Boolean(schemaVersionChanged)
    },
    impacted: impactedSubgraph(artifact, changedEvidence),
    curatedFields: collectCuratedFields(artifact),
    validation: {
      valid: validation.ok,
      status: validation.status,
      stdout: validation.stdout,
      stderr: validation.stderr
    },
    verification: verification
      ? {
          ok: verification.ok,
          status: verification.status,
          stdout: verification.stdout,
          stderr: verification.stderr
        }
      : null
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifact = readJson(options.artifactPath);
  const plan = buildPlan({ ...options, artifact });
  const output = `${JSON.stringify(plan, null, 2)}\n`;

  if (options.outputPath) {
    fs.writeFileSync(options.outputPath, output);
  }

  process.stdout.write(output);
  process.exit(plan.validation.valid && (plan.verification?.ok ?? true) ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
