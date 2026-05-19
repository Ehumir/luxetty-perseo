'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { parseMd } = require('./mdParser');
const { parseTxt } = require('./txtParser');
const { parseCsv } = require('./csvParser');
const { parseJson } = require('./jsonParser');
const { parseDocx } = require('./docxParser');
const { parsePdf } = require('./pdfParser');

const PARSERS = {
  '.md': { format: 'md', parse: parseMd },
  '.txt': { format: 'txt', parse: parseTxt },
  '.csv': { format: 'csv', parse: parseCsv },
  '.json': { format: 'json', parse: parseJson },
  '.docx': { format: 'docx', parse: parseDocx },
  '.pdf': { format: 'pdf', parse: parsePdf },
};

/**
 * @param {string} filePath
 * @param {{ import_batch_id?: string }} [opts]
 */
function parseFile(filePath, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const entry = PARSERS[ext];
  if (!entry) throw new Error(`Unsupported format: ${ext || '(none)'}`);
  const text = fs.readFileSync(filePath, 'utf8');
  const relFile = path.basename(filePath);
  const result = entry.parse(text, { file: relFile, ...opts });
  if (Array.isArray(result)) return result;
  return [result];
}

/**
 * @param {string} dir
 * @param {{ import_batch_id?: string }} [opts]
 */
function parseDirectory(dir, opts = {}) {
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  const records = [];
  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    if (!PARSERS[ext] || ext === '.docx' || ext === '.pdf') continue;
    records.push(...parseFile(full, opts));
  }
  return records;
}

module.exports = {
  parseFile,
  parseDirectory,
  parseMd,
  parseTxt,
  parseCsv,
  parseJson,
  parseDocx,
  parsePdf,
  PARSERS,
};
