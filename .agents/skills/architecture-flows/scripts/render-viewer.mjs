#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const validatorPath = path.join(scriptDir, 'validate-flows.mjs');
const templatePath = path.resolve(scriptDir, '../assets/viewer-template.html');
const placeholder = '__ARCHITECTURE_FLOWS_JSON__';

function usage(exitCode = 2) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write('Usage: render-viewer.mjs <architecture-flows.json> [architecture-flows.html]\n');
  process.exit(exitCode);
}

function defaultOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name.replace(/\.json$/u, '')}.html`);
}

function removeOutput(outputPath) {
  try {
    fs.rmSync(outputPath, { force: true });
  } catch (error) {
    console.error(`Could not remove stale output ${outputPath}: ${error.message}`);
  }
}

function sameFileTarget(inputPath, outputPath) {
  if (inputPath === outputPath) {
    return true;
  }

  if (!fs.existsSync(outputPath)) {
    return false;
  }

  if (!fs.existsSync(inputPath)) {
    return false;
  }

  const inputStat = fs.statSync(inputPath);
  const outputStat = fs.statSync(outputPath);
  if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
    return true;
  }

  return fs.realpathSync.native(inputPath) === fs.realpathSync.native(outputPath);
}

function validateInput(inputPath, outputPath) {
  const result = spawnSync(process.execPath, [validatorPath, inputPath], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    removeOutput(outputPath);
    const details = `${result.stderr}${result.stdout}`.trim();
    console.error(`Viewer generation validation failed for ${inputPath}.`);
    if (details) {
      console.error(details);
    }
    process.exit(result.status ?? 1);
  }
}

function readJson(inputPath) {
  try {
    return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    throw new Error(`${inputPath}: cannot read JSON after validation: ${error.message}`);
  }
}

function escapeJsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/[<>&\u2028\u2029]/gu, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

function render(inputPath, outputPath) {
  if (sameFileTarget(inputPath, outputPath)) {
    throw new Error('Input JSON and output HTML paths must be different.');
  }

  validateInput(inputPath, outputPath);

  const template = fs.readFileSync(templatePath, 'utf8');
  if (!template.includes(placeholder)) {
    throw new Error(`${templatePath}: missing ${placeholder} placeholder`);
  }

  const artifact = readJson(inputPath);
  const html = template.replace(placeholder, escapeJsonForScript(artifact));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`Rendered ${outputPath}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage(0);
  }
  if (args.length < 1 || args.length > 2) {
    usage(2);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1] ?? defaultOutputPath(inputPath));
  try {
    render(inputPath, outputPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
