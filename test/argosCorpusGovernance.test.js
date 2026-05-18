'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const INDEX = path.join(__dirname, '..', 'docs', 'argos', 'datasets', 'corpus-index.yaml');
const ROOT = path.join(__dirname, '..');

describe('argosCorpusGovernance', () => {
  it('corpus-index.yaml exists with ~210 entries', () => {
    assert.ok(fs.existsSync(INDEX));
    const text = fs.readFileSync(INDEX, 'utf8');
    const count = (text.match(/^\s+-\s+corpus_id:/gm) || []).length;
    assert.ok(count >= 200 && count <= 220, `unexpected entry count ${count}`);
  });

  it('validate-corpus-index.js passes', () => {
    execFileSync('node', ['scripts/validate-corpus-index.js'], { cwd: ROOT, stdio: 'pipe' });
  });

  it('promoted scenarios reference existing JSON files', () => {
    const text = fs.readFileSync(INDEX, 'utf8');
    const codes = [...text.matchAll(/scenario_code:\s+([A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const code of codes) {
      const p = path.join(ROOT, 'docs', 'argos', 'scenarios', `${code}.v1.json`);
      assert.ok(fs.existsSync(p), `missing scenario for ${code}`);
    }
  });
});
