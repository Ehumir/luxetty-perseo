'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseMd, parseTxt, parseCsv, parseJson } = require('../corpus/parsers');
const { validateConversationRecord } = require('../corpus/validateConversationRecord');
const { dedupeConversationRecords } = require('../corpus/dedupe');
const { parseDocx, parsePdf } = require('../corpus/parsers');

const FIXTURES = path.join(__dirname, '..', 'docs', 'argos', 'corpus', 'fixtures');

describe('Corpus Foundation M2-02', () => {
  it('parses MD fixture', () => {
    const fs = require('node:fs');
    const text = fs.readFileSync(path.join(FIXTURES, 'valid-sample.md'), 'utf8');
    const record = parseMd(text, { file: 'valid-sample.md' });
    assert.equal(record.corpus_id, 'FIXTURE-MD-001');
    assert.equal(record.turns.length, 3);
    const v = validateConversationRecord(record);
    assert.equal(v.ok, true);
    assert.match(v.outcome_hash, /^[a-f0-9]{16}$/);
  });

  it('parses TXT fixture', () => {
    const fs = require('node:fs');
    const text = fs.readFileSync(path.join(FIXTURES, 'valid-sample.txt'), 'utf8');
    const record = parseTxt(text, { file: 'valid-sample.txt' });
    assert.equal(record.corpus_id, 'FIXTURE-TXT-001');
    assert.equal(record.turns.length, 3);
  });

  it('parses CSV fixture', () => {
    const fs = require('node:fs');
    const text = fs.readFileSync(path.join(FIXTURES, 'valid-sample.csv'), 'utf8');
    const record = parseCsv(text, { file: 'valid-sample.csv' });
    assert.equal(record.corpus_id, 'FIXTURE-CSV-001');
    assert.equal(record.turns.length, 3);
  });

  it('parses JSON fixture', () => {
    const fs = require('node:fs');
    const text = fs.readFileSync(path.join(FIXTURES, 'valid-sample.json'), 'utf8');
    const record = parseJson(text, { file: 'valid-sample.json' });
    assert.equal(record.corpus_id, 'FIXTURE-JSON-001');
    const v = validateConversationRecord(record);
    assert.equal(v.ok, true);
  });

  it('detects duplicate outcome_hash', () => {
    const fs = require('node:fs');
    const a = parseJson(fs.readFileSync(path.join(FIXTURES, 'duplicate-a.json'), 'utf8'));
    const b = parseJson(fs.readFileSync(path.join(FIXTURES, 'duplicate-b.json'), 'utf8'));
    const { duplicates, unique } = dedupeConversationRecords([a, b]);
    assert.equal(duplicates.length, 1);
    assert.equal(unique.length, 0);
    assert.equal(duplicates[0].corpus_ids.length, 2);
  });

  it('rejects invalid turns, role, promotion', () => {
    const fs = require('node:fs');
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'invalid-empty-turns.json'), 'utf8'));
    const role = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'invalid-role.json'), 'utf8'));
    const promo = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'invalid-promotion.json'), 'utf8'));
    assert.equal(validateConversationRecord(empty).ok, false);
    assert.equal(validateConversationRecord(role).ok, false);
    const promoResult = validateConversationRecord(promo);
    assert.equal(promoResult.ok, false);
    assert.ok(promoResult.issues.some((i) => i.code === 'invalid_promotion_status' || i.code === 'auto_promote_forbidden'));
  });

  it('DOCX/PDF stubs throw NOT_IMPLEMENTED', () => {
    assert.throws(() => parseDocx(), (e) => e.code === 'NOT_IMPLEMENTED');
    assert.throws(() => parsePdf(), (e) => e.code === 'NOT_IMPLEMENTED');
  });
});
