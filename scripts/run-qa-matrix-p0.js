#!/usr/bin/env node
'use strict';

/**
 * Matriz QA P0 conversacional (20 escenarios simulados tipo WhatsApp).
 * Uso: node scripts/run-qa-matrix-p0.js
 * Opcional: node scripts/run-qa-matrix-p0.js --write docs/QA_MATRIX_P0_CONVERSATIONAL.md
 */

const fs = require('fs');
const path = require('path');
const { runAllMatrix, formatMarkdownTable } = require('../test/qaMatrixP0ConversationalHarness');

const results = runAllMatrix();
const md = formatMarkdownTable(results);
const allPass = results.every((r) => r.pass);

console.log(md);
console.log('\n---\nResumen:', allPass ? '20/20 PASS' : `FAIL ${results.filter((r) => !r.pass).map((r) => r.id).join(', ')}`);

const writeIdx = process.argv.indexOf('--write');
if (writeIdx !== -1 && process.argv[writeIdx + 1]) {
  const out = path.resolve(process.cwd(), process.argv[writeIdx + 1]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md, 'utf8');
  console.log('Escrito:', out);
}

process.exit(allPass ? 0 : 1);
