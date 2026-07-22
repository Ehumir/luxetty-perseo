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

    let capturedRpc = null;
    ragService.semanticSearch = async (_db, opts) => {
      capturedRpc = opts.rpcParams;
      return {
        chunks: [
          { registry_domain_code: 'commercial_objections', similarity: 0.9, content: 'objeción comisión' },
          { registry_domain_code: 'properties', similarity: 0.8, content: 'prop' },
        ],
        fallback: false,
        query_hash: 'r1',
        latency_ms: 50,
      };
    };

    const out = await ragRules.fetchRulesChunks({}, { query: 'comisión alta', domain: 'commercial_objections' });
    assert.equal(out.fallback, false);
    assert.ok(out.chunks.every((c) => ragRules.RULES_DOMAINS.includes(c.registry_domain_code)));
    assert.equal(capturedRpc.filter_source_type, null);
    assert.equal(capturedRpc.filter_visibility_scope, null);
    assert.equal(capturedRpc.filter_property_id, null);
    assert.equal(capturedRpc.filter_registry_domain_code, undefined);
  });

  it('S4-R02-fix — buildRulesRetrievalQuery enriquece objeción comisión', () => {
    const q = ragRules.buildRulesRetrievalQuery('Me parece mucho la comisión', 'commercial_objections');
    assert.match(q, /comisión/i);
    assert.match(q, /transparencia/i);
  });

  it('BK100 — fetchRulesContextPack filtra dominio (no mezcla properties)', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_RULES_ENABLED = 'true';

    ragService.semanticSearch = async () => ({
      chunks: [
        {
          registry_domain_code: 'commercial_objections',
          similarity: 0.91,
          content: 'objeción comisión transparencia',
          chunk_id: 'c1',
          source_id: 's1',
          source_type: 'objection',
        },
        {
          registry_domain_code: 'zones',
          similarity: 0.89,
          content: 'zona cumbres',
          chunk_id: 'c2',
          source_id: 's2',
          source_type: 'zone',
        },
        {
          registry_domain_code: 'properties',
          similarity: 0.88,
          content: 'propiedad LUX',
          chunk_id: 'c3',
          source_id: 's3',
          source_type: 'property',
        },
      ],
      fallback: false,
      query_hash: 'bk1',
      latency_ms: 40,
    });

    const out = await ragRules.fetchRulesContextPack(
      {},
      { query: 'comisión alta', domain: 'commercial_objections' }
    );
    assert.equal(out.domain_filter_applied, true);
    assert.equal(out.domain_selected, 'commercial_objections');
    assert.equal(out.fallback, false);
    const domains = (out.contextPack?.sources || []).map((s) => s.registry_domain_code);
    assert.ok(domains.every((d) => d === 'commercial_objections'));
    assert.ok((out.contextPack?.citations || []).every((c) => c.rank >= 1));
  });
});
