#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const textExtensions = new Set([
  '.env',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
  '.properties'
]);

const secretKeyPattern = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|private[_-]?key|token)/i;
const assignmentPattern = /["']?([A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|private[_-]?key|token)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?([^"',\s}]+)["']?/i;
const tokenPattern = /\b[A-Za-z0-9_./+=-]{24,}\b/g;

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function isSecretBearingPath(relativePath) {
  const base = path.basename(relativePath);
  return base === '.env' || base.startsWith('.env.');
}

function isLikelyTextFile(filePath) {
  const base = path.basename(filePath);
  return textExtensions.has(path.extname(filePath)) || base === '.env' || base.startsWith('.env.');
}

function entropy(value) {
  const counts = new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let total = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    total -= probability * Math.log2(probability);
  }
  return total;
}

function isHighEntropyToken(value) {
  if (value.length < 24) {
    return false;
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return false;
  }
  return entropy(value) >= 4;
}

function walk(rootPath) {
  const entries = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const isRootTmpDirectory = directory === rootPath && entry.name === 'tmp';
      if (entry.isDirectory() && (isRootTmpDirectory || ignoredDirectories.has(entry.name))) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        entries.push(absolutePath);
      }
    }
  }

  visit(rootPath);
  return entries.sort((a, b) => toPosixPath(path.relative(rootPath, a)).localeCompare(toPosixPath(path.relative(rootPath, b))));
}

function addFinding(findings, seen, finding) {
  const key = `${finding.path}:${finding.line ?? ''}:${finding.kind}:${finding.reason}:${finding.name ?? ''}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  findings.push(finding);
}

export function scanSecrets(targetPath) {
  const rootPath = path.resolve(targetPath);
  const stats = fs.statSync(rootPath);
  const files = stats.isDirectory() ? walk(rootPath) : [rootPath];
  const findings = [];
  const seen = new Set();

  for (const filePath of files) {
    const relativePath = stats.isDirectory() ? toPosixPath(path.relative(rootPath, filePath)) : path.basename(filePath);

    if (isSecretBearingPath(relativePath)) {
      addFinding(findings, seen, {
        path: relativePath,
        kind: 'secret-bearing-file',
        reason: 'secret-bearing-file'
      });
      continue;
    }

    if (!isLikelyTextFile(filePath)) {
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      addFinding(findings, seen, {
        path: relativePath,
        kind: 'read-error',
        reason: 'read-error',
        message: error.message
      });
      continue;
    }

    text.split(/\r?\n/).forEach((line, index) => {
      const assignment = line.match(assignmentPattern);
      if (assignment && assignment[2] && assignment[2].length > 3) {
        addFinding(findings, seen, {
          path: relativePath,
          line: index + 1,
          kind: 'secret-value',
          reason: 'secret-like-key',
          name: assignment[1]
        });
      } else if (secretKeyPattern.test(line) && /[:=]/.test(line)) {
        addFinding(findings, seen, {
          path: relativePath,
          line: index + 1,
          kind: 'secret-value',
          reason: 'secret-like-key'
        });
      }

      for (const token of line.matchAll(tokenPattern)) {
        if (isHighEntropyToken(token[0])) {
          addFinding(findings, seen, {
            path: relativePath,
            line: index + 1,
            kind: 'high-entropy-token',
            reason: 'high-entropy-token',
            length: token[0].length
          });
        }
      }
    });
  }

  findings.sort((a, b) =>
    `${a.path}:${a.line ?? 0}:${a.kind}:${a.reason}`.localeCompare(`${b.path}:${b.line ?? 0}:${b.kind}:${b.reason}`)
  );

  return {
    metadata: {
      targetPath: rootPath,
      generatedAt: new Date(0).toISOString(),
      scanner: 'check-secrets.mjs'
    },
    findings
  };
}

function main() {
  const [targetPath] = process.argv.slice(2);
  if (!targetPath || targetPath === '--help') {
    console.error('Usage: check-secrets.mjs <repo-or-file>');
    process.exit(targetPath === '--help' ? 0 : 2);
  }

  try {
    console.log(`${JSON.stringify(scanSecrets(targetPath), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
