'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'coverage',
  'dist',
  'build',
]);

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) walk(full, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js')) continue;
    out.push(full);
  }

  return out;
}

function checkFile(filePath) {
  const proc = spawnSync(process.execPath, ['--check', filePath], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  return {
    ok: proc.status === 0,
    stderr: String(proc.stderr || ''),
    stdout: String(proc.stdout || ''),
    filePath,
  };
}

function main() {
  const files = walk(ROOT).sort();

  if (files.length === 0) {
    console.log('LINT_OK no_js_files_found');
    return;
  }

  const failed = [];

  for (const file of files) {
    const result = checkFile(file);
    if (!result.ok) failed.push(result);
  }

  if (failed.length > 0) {
    console.error(`LINT_FAILED syntax_errors=${failed.length}`);
    for (const item of failed) {
      const rel = path.relative(ROOT, item.filePath);
      console.error(`\\n--- ${rel} ---`);
      const output = (item.stderr || item.stdout || '').trim();
      if (output) console.error(output);
    }
    process.exit(1);
  }

  console.log(`LINT_OK checked_files=${files.length}`);
}

main();
