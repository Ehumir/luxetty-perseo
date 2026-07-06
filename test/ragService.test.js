'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ragService = require('../services/ragService');
const { applyContextBudget, MAX_CONTEXT_TOKENS } = require('../conversation/v3/rag/contextBudget');
const {
  evaluateRetrieval,
  filterValidChunks,
  canAssertClaim,
  isPropertyRowPublishable,
  DEFAULT_MIN_SCORE,
} = require('../conversation/v3/rag/ragPolicy');

describe('ragService — Sprint 3', () => {
  beforeEach(() => {
    ragService._clearEmbeddingCacheForTests();
    delete process.env.RAG_P0_ENABLED;
  });

  it('S3-R25 — RAG_P0_ENABLED=false: semanticSearch retorna fallback sin RPC', async () => {
    let rpcCalled = false;
    const db = { rpc: () => { rpcCalled = true; } };
    const out = await ragService.semanticSearch(db, { query: 'casa en venta', rpcName: 'match_property_chunks' });
    assert.equal(out.fallback, true);
    assert.equal(rpcCalled, false);
    assert.deepEqual(out.chunks, []);
  });

  it('S3-R01 — selectCandidates ordena por score descendente', () => {
    const chunks = [
      { id: 'a', similarity: 0.7 },
      { id: 'b', similarity: 0.9 },
      { id: 'c', similarity: 0.8 },
    ];
    const sel = ragService.selectCandidates(chunks, { topK: 2 });
    assert.equal(sel[0].id, 'b');
    assert.equal(sel[1].id, 'c');
  });

  it('S3-R24 — applyThresholds filtra bajo min_score', () => {
    const chunks = [
      { similarity: 0.9 },
      { similarity: 0.5 },
      { similarity: DEFAULT_MIN_SCORE },
    ];
    const out = ragService.applyThresholds(chunks);
    assert.equal(out.length, 2);
    assert.ok(out.every((c) => c.similarity >= DEFAULT_MIN_SCORE));
  });

  it('S3-R07 — evaluateRetrieval detecta ambigüedad por gap', () => {
    const evalResult = evaluateRetrieval(
      [{ similarity: 0.85 }, { similarity: 0.83 }],
      { ambiguityGap: 0.05 }
    );
    assert.equal(evalResult.ambiguous, true);
    assert.ok(evalResult.confidence < 0.85);
  });

  it('S3-R06 — evaluateRetrieval sin candidatos → fallback', () => {
    const evalResult = evaluateRetrieval([]);
    assert.equal(evalResult.fallback, true);
    assert.equal(evalResult.top, null);
  });

  it('S3-R22 — filterValidChunks excluye inactivos y agent_only', () => {
    const chunks = [
      { is_active: true, visibility_scope: 'public' },
      { is_active: false, visibility_scope: 'public' },
      { is_active: true, visibility_scope: 'agent_only' },
      { is_active: true, visibility_scope: 'public', metadata: { phone: '+521' } },
    ];
    const valid = filterValidChunks(chunks);
    assert.equal(valid.length, 1);
  });

  it('S3-R26 — canAssertClaim bloquea sin citations', () => {
    assert.equal(canAssertClaim({ confidence: 0.9, citations: [] }), false);
    assert.equal(canAssertClaim({ confidence: 0.9, citations: [{ score: 0.8 }] }), true);
  });

  it('S3-R22 — isPropertyRowPublishable rechaza ocultas', () => {
    assert.equal(isPropertyRowPublishable({ id: '1', is_public: true }), true);
    assert.equal(isPropertyRowPublishable({ id: '1', is_public: false, visible_on_website: false }), false);
    assert.equal(isPropertyRowPublishable({ id: '1', status: 'archived', is_public: true }), false);
  });

  it('Context Budget — respeta MAX 2500 tokens y prioridad property', () => {
    const chunks = [
      { source_type: 'script', content: 'x'.repeat(4000), registry_domain_code: 'scripts' },
      { source_type: 'property', content: 'casa', registry_domain_code: 'properties' },
      { registry_domain_code: 'rules_perseo', content: 'regla', chunk_type: 'rule' },
    ];
    const budget = applyContextBudget(chunks);
    assert.ok(budget.context_tokens_estimated <= MAX_CONTEXT_TOKENS);
    assert.ok(budget.chunks_selected >= 1);
    assert.equal(budget.selected[0].source_type, 'property');
  });

  it('createContextPack incluye sources, citations, scores, confidence, tokens', () => {
    const pack = ragService.createContextPack({
      chunks: [{ id: 'c1', source_type: 'property', source_id: 'p1', similarity: 0.88, content: 'LUX: LUX-A0001' }],
      confidence: 0.88,
      budgetMeta: { context_tokens_estimated: 10, chunks_selected: 1, chunks_dropped: 0 },
    });
    assert.equal(pack.context_pack_version, '1');
    assert.ok(Array.isArray(pack.sources));
    assert.ok(Array.isArray(pack.citations));
    assert.equal(pack.confidence, 0.88);
    assert.equal(pack.chunks_selected, 1);
  });

  it('mapLegacyShape expone forma mínima', () => {
    const legacy = ragService.mapLegacyShape({
      confidence: 0.8,
      citations: [{ score: 0.8 }],
      context_tokens_estimated: 100,
      fallback_used: false,
    });
    assert.equal(legacy.confidence, 0.8);
    assert.equal(legacy.fallback_used, false);
  });

  it('buildCitationsFromChunks usa chunk_id de RPC', () => {
    const cites = ragService.buildCitationsFromChunks([
      { chunk_id: 'uuid-1', source_type: 'objection', similarity: 0.8, content: 'test' },
    ]);
    assert.equal(cites[0].chunk_id, 'uuid-1');
  });

  it('persistRagQueryLog usa columnas schema real (sin PII)', async () => {
    const inserts = [];
    const db = {
      from(table) {
        return {
          insert(row) {
            inserts.push({ table, row });
            return {
              select() {
                return {
                  async maybeSingle() {
                    return { data: { id: 'log-1' }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const logId = await ragService.persistRagQueryLog(db, {
      queryHash: 'abc123',
      resultsCount: 1,
      citations: [{ chunk_id: 'chunk-1', score: 0.9 }],
    });
    assert.equal(logId, 'log-1');
    assert.equal(inserts[0].table, 'rag_query_logs');
    assert.equal(inserts[0].row.query_text_hash, 'abc123');
    assert.equal(inserts[0].row.embedding_model, 'text-embedding-3-small');
    assert.ok(!('query_text' in inserts[0].row));
    assert.equal(inserts[1].table, 'retrieval_citations');
    assert.equal(inserts[1].row[0].rank, 1);
  });
});
