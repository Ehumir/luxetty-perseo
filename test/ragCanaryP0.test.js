'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const flags = require('../config/accP0Flags');
const ragInv = require('../services/ragInventoryService');
const ragService = require('../services/ragService');
const { enrichTurnWithRagContext, detectRulesDomain } = require('../conversation/v3/rag/ragTurnOrchestrator');
const { pickGroundedExcerpt } = require('../conversation/v3/rag/ragTurnOrchestrator');
const inv = require('../services/propertyInventoryService');

const QA_PHONE = '5218181877351';
const originalSemanticSearch = ragService.semanticSearch;

describe('ragCanaryP0 — Sprint 4', () => {
  beforeEach(() => {
    delete process.env.RAG_P0_ENABLED;
    delete process.env.RAG_INVENTORY_ENABLED;
    delete process.env.RAG_RULES_ENABLED;
    delete process.env.RAG_P0_ALLOWLIST;
    ragService.semanticSearch = originalSemanticSearch;
  });

  afterEach(() => {
    ragService.semanticSearch = originalSemanticSearch;
  });

  it('S4-01 — RAG OFF → legacy idéntico (inventory effective false)', () => {
    assert.equal(flags.isRagInventoryEffectiveForUser(QA_PHONE), false);
  });

  it('S4-02 — RAG ON + fuera allowlist → no effective', () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = QA_PHONE;
    assert.equal(flags.isRagInventoryEffectiveForUser('5299999999999'), false);
  });

  it('S4-03 — RAG ON + allowlist → effective inventory', () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = QA_PHONE;
    assert.equal(flags.isRagInventoryEffectiveForUser(QA_PHONE), true);
  });

  it('S4-04 — LUX code en texto → fallback legacy aunque allowlist ON', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = QA_PHONE;
    const out = await ragInv.resolveInboundPropertyReference({}, { text: 'LUX-A0470', canaryPhone: QA_PHONE });
    assert.equal(out.status, 'fallback_legacy');
  });

  it('S4-05 — Master OFF anula inventory y rules', () => {
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_RULES_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = QA_PHONE;
    assert.equal(flags.isRagInventoryEffectiveForUser(QA_PHONE), false);
    assert.equal(flags.isRagRulesEffectiveForUser(QA_PHONE), false);
  });

  it('S4-13 — detectRulesDomain comisión → commercial_objections', () => {
    assert.equal(detectRulesDomain('la comisión es muy alta'), 'commercial_objections');
  });

  it('S4-14 — Rules OFF → orchestrator skip', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_RULES_ENABLED = 'false';
    process.env.RAG_P0_ALLOWLIST = QA_PHONE;
    const out = await enrichTurnWithRagContext({}, { text: 'comisión alta', phone: QA_PHONE });
    assert.equal(out.meta.skipped, true);
  });

  it('S4-26 — hallucination guard bloquea suffix sin citations', () => {
    const suffix = pickGroundedExcerpt({ confidence: 0.9, citations: [], fallback_used: false });
    assert.equal(suffix, null);
  });

  it('S4-29 — flags OFF prod path sin llamadas semanticSearch', async () => {
    let called = false;
    ragService.semanticSearch = async () => {
      called = true;
      return { chunks: [], fallback: true };
    };
    await ragInv.resolveInboundPropertyReference({}, { text: 'casa', canaryPhone: QA_PHONE });
    assert.equal(called, false);
  });

  it('S4-30 — allowlist vacía con flags ON → no effective', () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    assert.equal(flags.isRagInventoryEffectiveForUser(QA_PHONE), false);
  });
});

describe('ragCanaryP0 — propertyInventory allowlist gate', () => {
  beforeEach(() => {
    delete process.env.RAG_P0_ENABLED;
    delete process.env.RAG_INVENTORY_ENABLED;
    delete process.env.RAG_P0_ALLOWLIST;
  });

  it('S4-01 — código directo sin RAG aunque allowlist ON', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    const row = {
      id: 'p1',
      listing_id: 'LUX-A0123',
      is_public: true,
      title: 'T',
      slug: 't',
      operation_type: 'sale',
      price: 1,
    };
    const db = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          limit() { return this; },
          async maybeSingle() { return { data: row, error: null }; },
        };
      },
    };
    const out = await inv.resolveInboundPropertyReference(db, { code: 'LUX-A0123', canaryPhone: QA_PHONE }, console);
    assert.equal(out.status, 'found');
    assert.notEqual(out.match_method, 'rag_semantic');
  });
});
