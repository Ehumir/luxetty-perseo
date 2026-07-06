'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ragRules = require('../services/ragRulesService');
const ragService = require('../services/ragService');

const originalSemanticSearch = ragService.semanticSearch;

describe('ragRulesService — Sprint 3', () => {
  beforeEach(() => {
    delete process.env.RAG_P0_ENABLED;
    delete process.env.RAG_RULES_ENABLED;
    ragService.semanticSearch = originalSemanticSearch;
  });

  afterEach(() => {
    ragService.semanticSearch = originalSemanticSearch;
  });

  it('S3-R25 — flags OFF → fetchRulesChunks fallback', async () => {
    const out = await ragRules.fetchRulesChunks({}, { query: 'comisión' });
    assert.equal(out.fallback, true);
    assert.deepEqual(out.chunks, []);
  });

  it('S3-R12 — flags ON recupera dominio objection sin interpretar', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_RULES_ENABLED = 'true';

    ragService.semanticSearch = async () => ({
      chunks: [
        { registry_domain_code: 'commercial_objections', similarity: 0.9, content: 'objeción comisión' },
        { registry_domain_code: 'properties', similarity: 0.8, content: 'prop' },
      ],
      fallback: false,
      query_hash: 'r1',
      latency_ms: 50,
    });

    const out = await ragRules.fetchRulesChunks({}, { query: 'comisión alta' });
    assert.equal(out.fallback, false);
    assert.ok(out.chunks.every((c) => ragRules.RULES_DOMAINS.includes(c.registry_domain_code)));
  });
});
