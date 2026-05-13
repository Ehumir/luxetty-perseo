'use strict';

/**
 * Sprint 2 — Validación: un único módulo de servicio debe contener la URL Graph de envío de texto.
 * Excluye scripts/ y test/ (herramientas y pruebas pueden mencionar la ruta en comentarios).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const expectedFile = path.join('services', 'perseoAutomatedWhatsApp.js');

function walkJsFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'scripts' || ent.name === 'test') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, acc);
    else if (ent.isFile() && ent.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const hits = [];
for (const abs of walkJsFiles(root)) {
  const rel = path.relative(root, abs);
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('/messages')) hits.push(rel.split(path.sep).join('/'));
}

if (hits.length !== 1) {
  console.error('validate-graph-outbound: expected exactly 1 JS file containing /messages, got:', hits);
  process.exit(1);
}

const normalized = hits[0];
if (normalized !== expectedFile.split(path.sep).join('/')) {
  console.error('validate-graph-outbound: unexpected file:', normalized, 'expected', expectedFile.split(path.sep).join('/'));
  process.exit(1);
}

console.log('validate-graph-outbound ok', normalized);
