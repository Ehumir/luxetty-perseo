'use strict';

/**
 * Valida fixtures/batch corpus (offline). No toca runtime WhatsApp.
 *
 * Uso:
 *   node scripts/corpus-validate.js
 *   node scripts/corpus-validate.js --dir docs/argos/corpus/fixtures
 *   node scripts/corpus-validate.js --expect-invalid
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseFile, parseDirectory } = require('../corpus/parsers');
const { validateConversationRecord } = require('../corpus/validateConversationRecord');
const { dedupeConversationRecords } = require('../corpus/dedupe');

const DEFAULT_DIR = path.join(__dirname, '..', 'docs', 'argos', 'corpus', 'fixtures');
const INVALID_FIXTURES = new Set([
  'invalid-empty-turns.json',
  'invalid-role.json',
  'invalid-promotion.json',
]);

function main() {
  const args = process.argv.slice(2);
  const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : DEFAULT_DIR;
  const dir = path.resolve(dirArg);

  if (!fs.existsSync(dir)) {
    console.error('corpus-validate: directory not found', dir);
    process.exit(2);
  }

  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  const byFormat = { md: 0, txt: 0, csv: 0, json: 0 };
  const records = [];
  const parseErrors = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase().slice(1);
    if (!['md', 'txt', 'csv', 'json'].includes(ext)) continue;
    const full = path.join(dir, file);
    try {
      const parsed = parseFile(full, { import_batch_id: 'corpus-validate-cli' });
      byFormat[ext] += 1;
      for (const rec of parsed) {
        records.push({ record: rec, file });
      }
    } catch (err) {
      parseErrors.push({ file, message: err.message });
    }
  }

  const validationResults = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const { record, file } of records) {
    const result = validateConversationRecord(record);
    const expectThisInvalid = INVALID_FIXTURES.has(path.basename(file));
    validationResults.push({ file, corpus_id: record.corpus_id, ...result, expectInvalid: expectThisInvalid });
    if (result.ok) validCount += 1;
    else invalidCount += 1;
  }

  const fileByCorpusId = new Map(records.map((r) => [r.record.corpus_id, r.file]));
  const dedupe = dedupeConversationRecords(
    records.map((r) => r.record),
    { fileByCorpusId },
  );

  const duplicatePairsExpected =
    files.includes('duplicate-a.json') && files.includes('duplicate-b.json');

  let exitCode = 0;

  console.log('corpus-validate');
  console.log('  dir:', dir);
  console.log('  files_parsed:', files.length);
  console.log('  by_format:', JSON.stringify(byFormat));
  console.log('  records:', records.length);
  const expectedInvalid = validationResults.filter((v) => v.expectInvalid).length;
  const unexpectedInvalid = validationResults.filter((v) => !v.expectInvalid && !v.ok).length;
  console.log('  valid:', validCount);
  console.log('  invalid:', invalidCount);
  console.log('  expected_invalid:', expectedInvalid);
  console.log('  unexpected_invalid:', unexpectedInvalid);
  console.log('  parse_errors:', parseErrors.length);

  if (parseErrors.length) {
    console.error('  parse_errors_detail:', parseErrors);
    exitCode = 1;
  }

  for (const v of validationResults) {
    if (v.expectInvalid) {
      if (v.ok) {
        console.error('  FAIL expected invalid but passed:', v.file);
        exitCode = 1;
      }
      continue;
    }
    if (!v.ok && !v.expectInvalid) {
      console.error('  FAIL validation:', v.file, v.issues.filter((i) => i.level === 'error').map((i) => i.code));
      exitCode = 1;
    }
  }

  if (unexpectedInvalid > 0) exitCode = 1;

  console.log('  dedupe_unique:', dedupe.unique.length);
  console.log('  dedupe_duplicates:', dedupe.duplicates.length);
  if (dedupe.duplicates.length) {
    for (const d of dedupe.duplicates) {
      console.log('    duplicate outcome_hash=', d.outcome_hash, 'corpus_ids=', d.corpus_ids.join(','));
    }
  }

  if (duplicatePairsExpected && dedupe.duplicates.length === 0) {
    console.error('  FAIL expected duplicate pair in fixtures');
    exitCode = 1;
  }

  const validOnly = validationResults.filter((v) => v.ok && !v.expectInvalid);
  if (validOnly.length < 4) {
    console.error('  FAIL expected at least 4 valid fixtures (md,txt,csv,json)');
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log('corpus-validate: PASS');
  } else {
    console.error('corpus-validate: FAIL');
  }

  process.exit(exitCode);
}

main();
