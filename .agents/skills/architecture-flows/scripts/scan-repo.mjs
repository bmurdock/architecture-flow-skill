#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanSecrets } from './check-secrets.mjs';
import { extractJsTsFacts } from './extract-js-ts-facts.mjs';

const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
]);
const manifestNames = new Set(['package.json']);
const candidateExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.toml']);
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const configNames = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  'eslint.config.js'
]);

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function runGit(repoPath, args) {
  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getGitMetadata(repoPath) {
  return {
    branch: runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    commit: runGit(repoPath, ['rev-parse', 'HEAD']) ?? 'unknown',
    dirty: (runGit(repoPath, ['status', '--porcelain']) ?? '').length > 0
  };
}

function isCandidateFile(relativePath) {
  const base = path.basename(relativePath);
  const ext = path.extname(relativePath);
  return configNames.has(base) || candidateExtensions.has(ext);
}

function classifyFile(relativePath) {
  const base = path.basename(relativePath);
  const segments = relativePath.split('/');
  const ext = path.extname(relativePath);
  if (segments.includes('test') || segments.includes('tests') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) {
    return 'test';
  }
  if (configNames.has(base) || ['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
    return 'config';
  }
  if (sourceExtensions.has(ext)) {
    return 'source';
  }
  return 'candidate';
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function describeFile(repoPath, relativePath, options = {}) {
  const absolutePath = path.join(repoPath, relativePath);
  const stat = fs.statSync(absolutePath);
  const description = {
    path: relativePath,
    kind: classifyFile(relativePath),
    sizeBytes: stat.size
  };
  if (options.includeContentHash) {
    description.contentHash = sha256File(absolutePath);
  }
  return description;
}

function walk(repoPath) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const isRootTmpDirectory = directory === repoPath && entry.name === 'tmp';
      if (entry.isDirectory() && (isRootTmpDirectory || ignoredDirectories.has(entry.name))) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  visit(repoPath);
  return files.sort((a, b) => toPosixPath(path.relative(repoPath, a)).localeCompare(toPosixPath(path.relative(repoPath, b))));
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { error: error.message };
  }
}

function summarizePackageManifest(relativePath, manifest) {
  const summary = {
    path: relativePath,
    kind: 'package-json',
    name: manifest.name ?? null,
    type: manifest.type ?? null,
    scripts: Object.keys(manifest.scripts ?? {}).sort(),
    dependencies: Object.keys(manifest.dependencies ?? {}).sort(),
    devDependencies: Object.keys(manifest.devDependencies ?? {}).sort()
  };
  if (manifest.main) summary.main = manifest.main;
  if (manifest.module) summary.module = manifest.module;
  if (manifest.exports) summary.exports = manifest.exports;
  if (manifest.bin) summary.bin = manifest.bin;
  return summary;
}

function collectManifests(repoPath, allFiles) {
  const manifests = [];
  for (const filePath of allFiles) {
    const relativePath = toPosixPath(path.relative(repoPath, filePath));
    if (!manifestNames.has(path.basename(relativePath))) {
      continue;
    }

    const parsed = parseJsonFile(filePath);
    if (parsed.error) {
      manifests.push({ path: relativePath, kind: 'package-json', error: parsed.error });
    } else {
      manifests.push(summarizePackageManifest(relativePath, parsed));
    }
  }
  return manifests.sort((a, b) => a.path.localeCompare(b.path));
}

function importKind(source) {
  if (source.startsWith('.') || source.startsWith('/')) {
    return 'relative';
  }
  return 'package';
}

function nonCodeRanges(text) {
  const ranges = [];
  let index = 0;

  function pushRange(start, end) {
    if (end > start) {
      ranges.push({ start, end });
    }
  }

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '/' && next === '/') {
      const start = index;
      index += 2;
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      pushRange(start, index);
      continue;
    }

    if (character === '/' && next === '*') {
      const start = index;
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(index + 2, text.length);
      pushRange(start, index);
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      pushRange(start, index);
      continue;
    }

    index += 1;
  }

  return ranges;
}

function isInsideRanges(offset, ranges) {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function maskRanges(text, ranges) {
  const characters = [...text];
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      if (characters[index] !== '\n') {
        characters[index] = ' ';
      }
    }
  }
  return characters.join('');
}

function extractImports(repoPath, file) {
  const text = fs.readFileSync(path.join(repoPath, file.path), 'utf8');
  const ranges = nonCodeRanges(text);
  const imports = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (isInsideRanges(match.index ?? 0, ranges)) {
        continue;
      }
      imports.push({
        path: file.path,
        source: match[1],
        kind: importKind(match[1])
      });
    }
  }

  return imports;
}

function extractSymbols(repoPath, file) {
  const rawText = fs.readFileSync(path.join(repoPath, file.path), 'utf8');
  const text = maskRanges(rawText, nonCodeRanges(rawText));
  const symbols = [];
  const patterns = [
    { kind: 'function', pattern: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g },
    { kind: 'class', pattern: /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: 'const', pattern: /\bexport\s+const\s+([A-Za-z_$][\w$]*)\b/g }
  ];

  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }

  function lineFor(offset) {
    let line = 1;
    for (const start of lineStarts) {
      if (start > offset) break;
      line += 1;
    }
    return line - 1;
  }

  for (const { kind, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      symbols.push({
        path: file.path,
        name: match[1],
        kind,
        line: lineFor(match.index ?? 0)
      });
    }
  }

  return symbols.sort((a, b) => `${a.path}:${a.name}:${a.kind}`.localeCompare(`${b.path}:${b.name}:${b.kind}`));
}

function normalizeEntrypointPath(manifestPath, value) {
  if (typeof value !== 'string') {
    return null;
  }
  const baseDir = path.posix.dirname(manifestPath);
  const normalized = path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, value));
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function collectEntrypoints(manifests) {
  const entrypoints = [];

  function addEntrypoint(manifest, value, reason) {
    const entryPath = normalizeEntrypointPath(manifest.path, value);
    if (entryPath) {
      entrypoints.push({ path: entryPath, reason, manifest: manifest.path });
    }
  }

  function collectExportTargets(manifest, value, reason) {
    if (typeof value === 'string') {
      addEntrypoint(manifest, value, reason);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectExportTargets(manifest, item, reason);
      }
      return;
    }

    if (value && typeof value === 'object') {
      for (const key of Object.keys(value).sort()) {
        collectExportTargets(manifest, value[key], reason);
      }
    }
  }

  function collectPackageExports(manifest) {
    if (typeof manifest.exports === 'string') {
      addEntrypoint(manifest, manifest.exports, 'package.exports');
      return;
    }

    if (!manifest.exports || typeof manifest.exports !== 'object') {
      return;
    }

    const exportKeys = Object.keys(manifest.exports).filter((key) => key === '.' || key.startsWith('./')).sort();
    if (exportKeys.length === 0) {
      collectExportTargets(manifest, manifest.exports, 'package.exports');
      return;
    }

    for (const exportKey of exportKeys) {
      collectExportTargets(manifest, manifest.exports[exportKey], `package.exports[${exportKey}]`);
    }
  }

  for (const manifest of manifests) {
    for (const field of ['main', 'module']) {
      addEntrypoint(manifest, manifest[field], `package.${field}`);
    }

    if (typeof manifest.bin === 'string') {
      addEntrypoint(manifest, manifest.bin, 'package.bin');
    } else if (manifest.bin && typeof manifest.bin === 'object') {
      for (const binPath of Object.values(manifest.bin)) {
        addEntrypoint(manifest, binPath, 'package.bin');
      }
    }

    collectPackageExports(manifest);
  }
  return entrypoints.sort((a, b) => `${a.path}:${a.reason}`.localeCompare(`${b.path}:${b.reason}`));
}

export function scanRepository(targetPath) {
  const repoPath = path.resolve(targetPath);
  const allFiles = walk(repoPath);
  const secretReport = scanSecrets(repoPath);
  const redactedPaths = new Set(secretReport.findings.filter((finding) => finding.reason === 'secret-bearing-file').map((finding) => finding.path));
  const fileTree = allFiles
    .map((filePath) => toPosixPath(path.relative(repoPath, filePath)))
    .filter((relativePath) => !redactedPaths.has(relativePath))
    .map((relativePath) => describeFile(repoPath, relativePath))
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = allFiles
    .map((filePath) => toPosixPath(path.relative(repoPath, filePath)))
    .filter((relativePath) => !redactedPaths.has(relativePath) && isCandidateFile(relativePath))
    .map((relativePath) => describeFile(repoPath, relativePath, { includeContentHash: true }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifests = collectManifests(repoPath, allFiles.filter((filePath) => !redactedPaths.has(toPosixPath(path.relative(repoPath, filePath)))));
  const sourceFiles = files.filter((file) => sourceExtensions.has(path.extname(file.path)));
  const imports = sourceFiles.flatMap((file) => extractImports(repoPath, file)).sort((a, b) => `${a.path}:${a.source}`.localeCompare(`${b.path}:${b.source}`));
  const symbols = sourceFiles.flatMap((file) => extractSymbols(repoPath, file)).sort((a, b) => `${a.path}:${a.name}:${a.kind}`.localeCompare(`${b.path}:${b.name}:${b.kind}`));
  const astExtraction = extractJsTsFacts(repoPath, sourceFiles);
  const entrypoints = collectEntrypoints(manifests);

  return {
    metadata: {
      repositoryPath: repoPath,
      scanner: 'scan-repo.mjs',
      generatedAt: new Date(0).toISOString(),
      git: getGitMetadata(repoPath)
    },
    fileTree,
    files,
    manifests,
    imports,
    symbols,
    entrypoints,
    facts: astExtraction.facts,
    redactions: secretReport.findings,
    diagnostics: astExtraction.diagnostics
  };
}

function parseArgs(args) {
  const options = { output: null };
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output') {
      options.output = args[index + 1];
      index += 1;
    } else {
      positionals.push(args[index]);
    }
  }
  return { targetPath: positionals[0], options };
}

function main() {
  const { targetPath, options } = parseArgs(process.argv.slice(2));
  if (!targetPath || targetPath === '--help') {
    console.error('Usage: scan-repo.mjs <repo> [--output scan.json]');
    process.exit(targetPath === '--help' ? 0 : 2);
  }

  try {
    const output = `${JSON.stringify(scanRepository(targetPath), null, 2)}\n`;
    if (options.output) {
      fs.writeFileSync(options.output, output);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
