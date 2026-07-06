'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(ROOT, 'docs/argos/suites/rag-acc-p0.v1.json');

const REQUIRED_FILES = [
  'services/ragService.js',
  'services/ragInventoryService.js',
  'services/ragRulesService.js',
  'conversation/v3/rag/buildContextPack.js',
  'conversation/v3/rag/ragPolicy.js',
  'conversation/v3/rag/contextBudget.js',
];

describe('ragAccP0 — Sprint 3 ARGOS suite', () => {
  it('S3-STRUCT — archivos Sprint 3 existen', () => {
    for (const f of REQUIRED_FILES) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
    }
  });

  it('S3-STRUCT — ragService exporta API congelada', () => {
    const rag = require('../services/ragService');
    const api = [
      'semanticSearch',
      'buildContext',
      'selectCandidates',
      'applyThresholds',
      'createContextPack',
      'mapLegacyShape',
    ];
    for (const fn of api) {
      assert.equal(typeof rag[fn], 'function', `ragService.${fn}`);
    }
  });

  it('S3-STRUCT — ragRulesService solo recupera (sin CRM)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/ragRulesService.js'), 'utf8');
    assert.doesNotMatch(src, /\.from\(['"]leads['"]\)/);
    assert.doesNotMatch(src, /\.from\(['"]contacts['"]\)/);
    assert.match(src, /match_knowledge_chunks/);
  });

  it('S3-STRUCT — ragInventoryService no escribe CRM', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/ragInventoryService.js'), 'utf8');
    assert.doesNotMatch(src, /\.insert\(/);
    assert.doesNotMatch(src, /\.update\(/);
    assert.match(src, /match_property_chunks/);
  });

  it('S3-STRUCT — propertyInventoryService solo rama resolveInboundPropertyReference', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/propertyInventoryService.js'), 'utf8');
    assert.match(src, /isRagInventoryEffectiveForUser/);
    assert.match(src, /ragInventoryService/);
    assert.doesNotMatch(src, /ragService/);
  });

  it('S3-STRUCT — sin SQL directo a tablas knowledge', () => {
    for (const f of ['services/ragService.js', 'services/ragInventoryService.js', 'services/ragRulesService.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.doesNotMatch(src, /\.from\(['"]knowledge_/);
      assert.doesNotMatch(src, /FROM\s+public\.knowledge_/i);
    }
  });

  it('S3-STRUCT — suite ARGOS rag-acc-p0.v1.json', () => {
    assert.ok(fs.existsSync(SUITE));
    const suite = JSON.parse(fs.readFileSync(SUITE, 'utf8'));
    assert.equal(suite.suite, 'rag-acc-p0.v1');
    assert.ok(suite.scenarios.length >= 25, `expected >=25 scenarios, got ${suite.scenarios.length}`);
    const ids = suite.scenarios.map((s) => s.id);
    assert.ok(ids.includes('S3-R25'));
    assert.ok(ids.includes('S3-R01'));
    assert.ok(ids.includes('S3-R24'));
  });

  it('S3-R15 — reglas ATENA: leads no requests en servicios RAG', () => {
    for (const f of REQUIRED_FILES) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.doesNotMatch(src, /['"]requests['"]/);
    }
  });

  it('S3-R23 — sin creación de leads en capa RAG', () => {
    for (const f of REQUIRED_FILES) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.doesNotMatch(src, /\.from\(['"]leads['"]\)/);
    }
  });

  it('S3-R28 — ragService tiene cache embedding', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/ragService.js'), 'utf8');
    assert.match(src, /embeddingCache/);
    assert.match(src, /cache_hit/);
  });

  it('S3-R27 — timeout total 1.2s configurado', () => {
    const rag = require('../services/ragService');
    assert.equal(rag.RAG_TIMEOUT_MS, 1200);
  });

  it('S3-R05 — match_property_chunks wrapper (no duplicar lógica)', () => {
    const inv = fs.readFileSync(path.join(ROOT, 'services/ragInventoryService.js'), 'utf8');
    assert.match(inv, /match_property_chunks/);
    assert.doesNotMatch(inv, /knowledge_embeddings/);
  });

  it('S3-R11-R20 — rules service recupera dominios sin interpretar', () => {
    const rules = require('../services/ragRulesService');
    assert.ok(rules.RULES_DOMAINS.includes('rules_perseo'));
    assert.ok(rules.RULES_DOMAINS.includes('assignment_rules'));
    assert.equal(typeof rules.fetchRulesChunks, 'function');
  });

  it('S3-R26 — ragPolicy hallucination guard exportado', () => {
    const policy = require('../conversation/v3/rag/ragPolicy');
    assert.equal(typeof policy.canAssertClaim, 'function');
  });

  it('S3-R30 — Sprint 4 no iniciado (sin conversation memory)', () => {
    const budget = fs.readFileSync(path.join(ROOT, 'conversation/v3/rag/contextBudget.js'), 'utf8');
    assert.doesNotMatch(budget, /conversation_memory/);
    assert.ok(!fs.existsSync(path.join(ROOT, 'services/ragPlannerService.js')));
  });
});
