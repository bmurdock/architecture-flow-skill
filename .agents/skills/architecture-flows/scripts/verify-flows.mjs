#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const genericEvidenceIds = new Set([
  'ev',
  'ev:unknown',
  'ev:todo',
  'ev:tbd',
  'ev:placeholder',
  'unknown',
  'todo',
  'tbd',
  'placeholder'
]);

const inferencePattern = /\b(assum(?:e|ed|es|ing)|infer(?:red|s|ence)?|likel(?:y|ihood)|may|might|probably|possibly|appears?|seems?)\b/i;
const indirectPattern = /\b(indirect|incomplete|dynamic|framework[- ]mediated|conventional|naming)\b/i;
const directEvidencePattern = /\b(imports?|exports?|manifests?|entry[ -]?points?|calls?|called|invokes?|routes?|registers?|configures?)\b/i;
const placeholderPathPattern = /^(unknown|todo|tbd|placeholder|n\/a|none)$/i;

function usage(exitCode) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write('Usage: verify-flows.mjs [--strict] [--repo <path>] <architecture-flows.json> [...]\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const files = [];
  let repoPath = null;
  let strict = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage(0);
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--repo') {
      repoPath = argv[index + 1];
      if (!repoPath || repoPath.startsWith('--')) {
        usage(2);
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      usage(2);
    }
    files.push(arg);
  }

  if (files.length === 0) {
    usage(2);
  }

  return {
    files,
    repoPath: repoPath ? path.resolve(repoPath) : null,
    strict
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: cannot read JSON: ${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function confidenceOverall(item) {
  return isObject(item?.confidence) ? item.confidence.overall : undefined;
}

function hasHighConfidence(item) {
  return Object.values(item?.confidence ?? {}).includes('high') || confidenceOverall(item) === 'high';
}

function hasLowConfidence(item) {
  return Object.values(item?.confidence ?? {}).includes('low');
}

function textFields(item, fields) {
  return fields
    .map((field) => item?.[field])
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function semanticText(item, ignoredFields = []) {
  const ignored = new Set(ignoredFields);
  const strings = [];
  const seen = new Set();

  function collect(value) {
    if (typeof value === 'string') {
      strings.push(value);
      return;
    }

    if (value === null || typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const itemValue of value) {
        collect(itemValue);
      }
      return;
    }

    for (const [field, fieldValue] of Object.entries(value)) {
      if (!ignored.has(field)) {
        collect(fieldValue);
      }
    }
  }

  collect(item);
  return strings.join(' ');
}

function addEvidenceRefDiagnostics(errors, refs, evidenceIds, context) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${context} has no evidence references`);
    return;
  }

  for (const ref of refs) {
    if (!evidenceIds.has(ref)) {
      errors.push(`${context} references missing evidence "${ref}"`);
    }
    if (genericEvidenceIds.has(String(ref).toLowerCase())) {
      errors.push(`${context} references generic evidence id "${ref}"`);
    }
  }
}

function addDiagnostic(strict, errors, warnings, message) {
  if (strict) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

function validateNodeReference(errors, nodeId, nodeIds, context) {
  if (nodeId && !nodeIds.has(nodeId)) {
    errors.push(`Unknown node reference "${nodeId}" at ${context}`);
  }
}

function validateEdgeReference(errors, edgeId, edgeIds, context) {
  if (edgeId && !edgeIds.has(edgeId)) {
    errors.push(`Unknown edge reference "${edgeId}" at ${context}`);
  }
}

function verifyDerivedFrom(errors, item, factIds, context, strict) {
  if (!strict) {
    return;
  }

  const refs = item?.derivedFrom;
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${context} must include derivedFrom in strict mode`);
    return;
  }

  for (const ref of refs) {
    if (!factIds.has(ref)) {
      errors.push(`${context} references missing fact "${ref}" in derivedFrom`);
    }
  }
}

function evidenceIsStrong(evidence) {
  if (!isObject(evidence) || typeof evidence.path !== 'string' || placeholderPathPattern.test(evidence.path)) {
    return false;
  }

  if (typeof evidence.symbol === 'string' && evidence.symbol.length > 0) {
    return true;
  }

  if (typeof evidence.contentHash === 'string' && evidence.contentHash.startsWith('sha256:')) {
    return true;
  }

  return directEvidencePattern.test(`${evidence.kind ?? ''} ${evidence.reason ?? ''}`);
}

function verifyHighConfidenceEvidence(errors, item, evidenceById, context) {
  if (!hasHighConfidence(item)) {
    return;
  }

  const refs = asArray(item?.evidence);
  const hasStrongEvidence = refs.some((ref) => evidenceIsStrong(evidenceById.get(ref)));
  if (!hasStrongEvidence) {
    errors.push(`${context} uses high confidence without strong direct evidence`);
  }
}

function verifyClaim(errors, item, context, ignoredFields) {
  if (!isObject(item)) {
    return;
  }

  if (hasLowConfidence(item) && !item.uncertaintyReason) {
    errors.push(`${context} has low confidence without uncertaintyReason`);
  }

  const text = semanticText(item, ignoredFields);
  if (!inferencePattern.test(text)) {
    return;
  }

  if (hasHighConfidence(item)) {
    errors.push(`${context} uses inference wording with high confidence`);
  } else if (!item.uncertaintyReason) {
    errors.push(`${context} uses inference wording without uncertaintyReason`);
  }
}

function verifyRelationshipClaim(errors, item, context, ignoredFields) {
  if (!isObject(item)) {
    return;
  }

  if (hasLowConfidence(item) && !item.uncertaintyReason) {
    errors.push(`${context} has low confidence without uncertaintyReason`);
  }

  const text = semanticText(item, ignoredFields);
  const usesInference = inferencePattern.test(text);
  const usesIndirect = indirectPattern.test(text);
  if (!usesInference && !usesIndirect) {
    return;
  }

  if (hasHighConfidence(item)) {
    if (usesInference) {
      errors.push(`${context} uses inference wording with high confidence`);
    } else {
      errors.push(`${context} uses indirect wording with high confidence`);
    }
    return;
  }

  if (!item.uncertaintyReason) {
    errors.push(`${context} uses indirect or inference wording without uncertaintyReason`);
  }
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function currentGitCommit(repoPath) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function verifyEvidenceFreshness(errors, warnings, artifact, repoPath, strict) {
  if (!repoPath) {
    addDiagnostic(strict, errors, warnings, 'repository context not supplied; stale evidence checks limited to artifact structure');
    return;
  }

  const metadataCommit = artifact.metadata?.commit;
  const metadataCommitIsVerifiable = /^[a-f0-9]{40}$/i.test(metadataCommit ?? '');
  const evidenceRecords = asArray(artifact.evidence);
  const usableContentHashCount = evidenceRecords.filter((item) => typeof item?.contentHash === 'string' && item.contentHash.startsWith('sha256:')).length;

  if (!metadataCommitIsVerifiable) {
    addDiagnostic(strict, errors, warnings, 'metadata.commit is not a verifiable 40-character git hash');
  }

  if (evidenceRecords.length > 0 && usableContentHashCount === 0) {
    addDiagnostic(strict, errors, warnings, 'no evidence records include contentHash; stale evidence checks cannot compare file contents');
  }

  if (/^[a-f0-9]{40}$/i.test(metadataCommit ?? '')) {
    const currentCommit = currentGitCommit(repoPath);
    if (currentCommit && currentCommit !== metadataCommit) {
      errors.push(`metadata.commit ${metadataCommit} does not match repository HEAD ${currentCommit}`);
    } else if (!currentCommit) {
      addDiagnostic(strict, errors, warnings, 'metadata.commit could not be verified because repository HEAD is unavailable');
    }
  }

  for (const [index, evidence] of evidenceRecords.entries()) {
    if (!isObject(evidence)) {
      continue;
    }

    const relativeContext = `evidence[${index}] ${evidence.id ?? evidence.path ?? '(unknown)'}`;
    if (typeof evidence.path !== 'string') {
      if (strict) {
        errors.push(`${relativeContext} must include evidence.path in strict mode`);
      }
      continue;
    }

    const evidencePath = path.resolve(repoPath, evidence.path);
    if (!evidencePath.startsWith(`${repoPath}${path.sep}`) && evidencePath !== repoPath) {
      errors.push(`${relativeContext} path escapes repository context`);
      continue;
    }

    const pathExists = fs.existsSync(evidencePath);
    if (!pathExists) {
      addDiagnostic(strict, errors, warnings, `${relativeContext} path not found in repository context`);
    }

    if (typeof evidence.contentHash !== 'string') {
      if (strict) {
        errors.push(`${relativeContext} must include sha256 contentHash in strict mode`);
      }
      continue;
    }

    if (!evidence.contentHash.startsWith('sha256:')) {
      addDiagnostic(strict, errors, warnings, `${relativeContext} contentHash uses unsupported format`);
      continue;
    }

    if (!pathExists) {
      continue;
    }

    const currentHash = sha256File(evidencePath);
    if (currentHash !== evidence.contentHash) {
      errors.push(`${relativeContext} contentHash does not match current file`);
    }
  }
}

function verifyArtifact(artifact, repoPath, strict = false) {
  const errors = [];
  const warnings = [];
  const evidence = asArray(artifact.evidence);
  const evidenceIds = new Set(evidence.map((item) => item?.id).filter(Boolean));
  const evidenceById = new Map(evidence.map((item) => [item?.id, item]));
  const factIds = new Set(asArray(artifact.facts).map((item) => item?.id).filter(Boolean));
  const nodeIds = new Set(asArray(artifact.nodes).map((item) => item?.id).filter(Boolean));
  const edgeIds = new Set(asArray(artifact.edges).map((item) => item?.id).filter(Boolean));

  for (const [index, item] of evidence.entries()) {
    const context = `evidence[${index}]`;
    const id = item?.id;
    if (typeof id === 'string' && genericEvidenceIds.has(id.toLowerCase())) {
      errors.push(`${context} uses generic evidence id "${id}"`);
    }
    if (typeof item?.path === 'string' && placeholderPathPattern.test(item.path)) {
      errors.push(`${context} uses placeholder evidence path "${item.path}"`);
    }
    if (typeof item?.reason === 'string' && inferencePattern.test(item.reason)) {
      addDiagnostic(strict, errors, warnings, `${context} reason uses inference wording; verify the referenced source supports it`);
    }
  }

  for (const [index, fact] of asArray(artifact.facts).entries()) {
    addEvidenceRefDiagnostics(errors, fact?.evidence, evidenceIds, `facts[${index}]`);
  }

  for (const [index, node] of asArray(artifact.nodes).entries()) {
    const context = `nodes[${index}]`;
    verifyDerivedFrom(errors, node, factIds, context, strict);
    addEvidenceRefDiagnostics(errors, node?.evidence, evidenceIds, context);
    verifyHighConfidenceEvidence(errors, node, evidenceById, context);
    verifyClaim(errors, node, context, ['id', 'kind', 'path', 'symbol', 'evidence', 'confidence']);
  }

  for (const [index, edge] of asArray(artifact.edges).entries()) {
    const context = `edges[${index}]`;
    validateNodeReference(errors, edge?.from, nodeIds, `${context}.from`);
    validateNodeReference(errors, edge?.to, nodeIds, `${context}.to`);
    verifyDerivedFrom(errors, edge, factIds, context, strict);
    addEvidenceRefDiagnostics(errors, edge?.evidence, evidenceIds, context);
    verifyHighConfidenceEvidence(errors, edge, evidenceById, context);
    verifyRelationshipClaim(errors, edge, context, ['id', 'from', 'to', 'evidence', 'confidence']);
  }

  for (const [flowIndex, flow] of asArray(artifact.flows).entries()) {
    validateNodeReference(errors, flow?.entry, nodeIds, `flows[${flowIndex}].entry`);
    validateNodeReference(errors, flow?.exit, nodeIds, `flows[${flowIndex}].exit`);

    const flowText = textFields(flow, ['name', 'summary', 'trigger']);
    if (inferencePattern.test(flowText)) {
      addDiagnostic(strict, errors, warnings, `flows[${flowIndex}] uses inference wording; human review required`);
    }

    for (const [stepIndex, step] of asArray(flow?.steps).entries()) {
      const context = `flows[${flowIndex}].steps[${stepIndex}]`;
      validateNodeReference(errors, step?.node, nodeIds, `${context}.node`);
      validateEdgeReference(errors, step?.edge, edgeIds, `${context}.edge`);
      verifyDerivedFrom(errors, step, factIds, context, strict);
      addEvidenceRefDiagnostics(errors, step?.evidence, evidenceIds, context);
      verifyHighConfidenceEvidence(errors, step, evidenceById, context);
      verifyRelationshipClaim(errors, step, context, ['id', 'node', 'edge', 'evidence', 'confidence']);
    }
  }

  for (const [index, diagnostic] of asArray(artifact.diagnostics).entries()) {
    if (diagnostic?.severity === 'error') {
      errors.push(`diagnostics[${index}] has error severity and requires resolution before publishing`);
    }
    if (diagnostic?.evidence !== undefined) {
      addEvidenceRefDiagnostics(errors, diagnostic.evidence, evidenceIds, `diagnostics[${index}]`);
    }
  }

  verifyEvidenceFreshness(errors, warnings, artifact, repoPath, strict);

  return { errors, warnings };
}

function main() {
  const { files, repoPath, strict } = parseArgs(process.argv.slice(2));
  let failed = false;

  for (const file of files) {
    const artifact = readJson(file);
    const { errors, warnings } = verifyArtifact(artifact, repoPath, strict);

    if (errors.length > 0) {
      failed = true;
      console.error(`${file}: verification failed`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    } else if (warnings.length > 0) {
      console.log(`${file}: verified with warnings`);
    } else {
      console.log(`${file}: verified`);
    }

    for (const warning of warnings) {
      console.log(`- warning: ${warning}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
