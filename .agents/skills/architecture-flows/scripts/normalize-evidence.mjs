#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function slug(value) {
  return String(value)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'root';
}

function provenance(scan, kind) {
  return {
    scanner: scan.metadata?.scanner ?? 'scan-repo.mjs',
    kind
  };
}

function sortById(items) {
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix, readableParts, identity) {
  const readable = readableParts.map(slug).join(':');
  return `${prefix}:${readable}:${stableHash(JSON.stringify(identity))}`;
}

function normalizeCollection(items, makeBaseId, makeItem, makeCollisionSuffix = defaultCollisionSuffix) {
  const groups = new Map();
  for (const sourceItem of items) {
    const item = makeItem(sourceItem);
    const baseId = makeBaseId(sourceItem);
    const entries = groups.get(baseId) ?? [];
    entries.push({ sourceItem, item });
    groups.set(baseId, entries);
  }

  const normalized = [];
  for (const [baseId, entries] of groups) {
    entries.sort((a, b) => JSON.stringify(a.item).localeCompare(JSON.stringify(b.item)));
    const usedIds = new Set();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let id = baseId;
      if (entries.length > 1) {
        id = `${baseId}:${makeCollisionSuffix(entry.sourceItem, entry.item, index + 1)}`;
      }
      while (usedIds.has(id)) {
        id = `${id}:${index + 1}`;
      }
      usedIds.add(id);
      normalized.push({ id, ...entry.item });
    }
  }

  return sortById(normalized);
}

function defaultCollisionSuffix(sourceItem, item, duplicateIndex) {
  return stableHash(JSON.stringify({ sourceItem, item, duplicateIndex }));
}

function entrypointCollisionSuffix(sourceItem, item, duplicateIndex) {
  if (sourceItem.manifest) {
    return slug(sourceItem.manifest);
  }
  return defaultCollisionSuffix(sourceItem, item, duplicateIndex);
}

function normalizeRedactions(scan) {
  const redactions = (scan.redactions ?? []).map((item) => {
    const stableKey = [
      slug(item.path),
      item.line ?? 0,
      slug(item.kind),
      slug(item.reason),
      item.name ? `name-${slug(item.name)}` : `length-${item.length ?? 0}`
    ].join(':');

    return {
      stableKey,
      path: item.path,
      line: item.line,
      kind: item.kind,
      reason: item.reason,
      name: item.name,
      length: item.length,
      provenance: provenance(scan, 'redaction')
    };
  });

  redactions.sort((a, b) => `${a.stableKey}:${JSON.stringify(a)}`.localeCompare(`${b.stableKey}:${JSON.stringify(b)}`));

  const seen = new Map();
  return sortById(redactions.map(({ stableKey, ...redaction }) => {
    const duplicateIndex = seen.get(stableKey) ?? 0;
    seen.set(stableKey, duplicateIndex + 1);
    return {
      id: duplicateIndex === 0 ? `redaction:${stableKey}` : `redaction:${stableKey}:${duplicateIndex + 1}`,
      ...redaction
    };
  }));
}

function normalizeFacts(scan, fileEvidenceIdByPath, diagnostics) {
  const missingEvidencePaths = new Set();
  return normalizeCollection(scan.facts ?? [], (item) => stableId('fact', [
    item.path,
    item.kind,
    item.symbol ?? item.source ?? item.target
  ], {
    kind: item.kind,
    path: item.path,
    symbol: item.symbol,
    source: item.source,
    target: item.target,
    language: item.language,
    provenance: item.provenance,
    location: item.location
  }), (item) => {
    const fileEvidenceId = fileEvidenceIdByPath.get(item.path);
    if (!fileEvidenceId && !missingEvidencePaths.has(item.path)) {
      missingEvidencePaths.add(item.path);
      diagnostics.push({
        id: `fact-without-file-evidence:${item.path}`,
        severity: 'warning',
        message: `Fact for ${item.path} has no normalized file evidence.`
      });
    }

    return {
      kind: item.kind,
      path: item.path,
      symbol: item.symbol,
      source: item.source,
      target: item.target,
      language: item.language,
      provenance: item.provenance,
      location: item.location,
      evidence: [fileEvidenceId].filter(Boolean)
    };
  });
}

export function normalizeEvidence(scan) {
  const metadata = {
    repositoryPath: scan.metadata?.repositoryPath ?? null,
    git: scan.metadata?.git ?? null,
    generatedAt: scan.metadata?.generatedAt ?? null,
    normalizer: 'normalize-evidence.mjs'
  };
  const diagnostics = (scan.diagnostics ?? []).map((item) => ({ ...item }));
  const fileTree = normalizeCollection(scan.fileTree ?? [], (file) => stableId('file-tree', [file.path], file), (file) => ({
    path: file.path,
    kind: file.kind,
    sizeBytes: file.sizeBytes,
    provenance: provenance(scan, 'file-tree')
  }));
  const files = normalizeCollection(scan.files ?? [], (file) => stableId('file', [file.path], file), (file) => ({
    path: file.path,
    kind: file.kind,
    sizeBytes: file.sizeBytes,
    contentHash: file.contentHash,
    provenance: provenance(scan, 'file')
  }));
  const fileEvidenceIdByPath = new Map(files.map((file) => [file.path, file.id]));
  const facts = normalizeFacts(scan, fileEvidenceIdByPath, diagnostics);

  return {
    metadata,
    fileTree,
    files,
    manifests: normalizeCollection(scan.manifests ?? [], (manifest) => stableId('manifest', [manifest.path], manifest), (manifest) => ({
      path: manifest.path,
      kind: manifest.kind,
      name: manifest.name ?? null,
      type: manifest.type ?? null,
      scripts: manifest.scripts ?? [],
      dependencies: manifest.dependencies ?? [],
      devDependencies: manifest.devDependencies ?? [],
      provenance: provenance(scan, 'manifest')
    })),
    imports: normalizeCollection(scan.imports ?? [], (item) => stableId('import', [item.path, item.source], item), (item) => ({
      path: item.path,
      source: item.source,
      kind: item.kind,
      provenance: provenance(scan, 'import')
    })),
    symbols: normalizeCollection(scan.symbols ?? [], (item) => stableId('symbol', [item.path, item.name], item), (item) => ({
      path: item.path,
      name: item.name,
      kind: item.kind,
      line: item.line,
      provenance: provenance(scan, 'symbol')
    })),
    entrypoints: normalizeCollection(scan.entrypoints ?? [], (item) => stableId('entrypoint', [item.path, item.reason, item.manifest], item), (item) => ({
      path: item.path,
      reason: item.reason,
      manifest: item.manifest,
      provenance: provenance(scan, 'entrypoint')
    }), entrypointCollisionSuffix),
    facts,
    redactions: normalizeRedactions(scan),
    diagnostics
  };
}

function main() {
  const [scanPath] = process.argv.slice(2);
  if (!scanPath || scanPath === '--help') {
    console.error('Usage: normalize-evidence.mjs <scan.json>');
    process.exit(scanPath === '--help' ? 0 : 2);
  }

  try {
    const scan = JSON.parse(fs.readFileSync(path.resolve(scanPath), 'utf8'));
    console.log(`${JSON.stringify(normalizeEvidence(scan), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
