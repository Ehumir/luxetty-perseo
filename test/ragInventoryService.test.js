'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ragInventory = require('../services/ragInventoryService');
const ragService = require('../services/ragService');
const inv = require('../services/propertyInventoryService');

const originalSemanticSearch = ragService.semanticSearch;

describe('ragInventoryService — Sprint 3', () => {
  beforeEach(() => {
    delete process.env.RAG_P0_ENABLED;
    delete process.env.RAG_INVENTORY_ENABLED;
    delete process.env.RAG_P0_ALLOWLIST;
    ragService.semanticSearch = originalSemanticSearch;
  });

  afterEach(() => {
    ragService.semanticSearch = originalSemanticSearch;
  });

  it('S3-R25 — flags OFF → fallback_legacy inmediato', async () => {
    const out = await ragInventory.resolveInboundPropertyReference({}, { text: 'casa en venta' });
    assert.equal(out.status, 'fallback_legacy');
  });

  it('S4-R03-fix — buildInventoryRetrievalQuery alinea formato chunk', () => {
    const q = ragInventory.buildInventoryRetrievalQuery('Busco casa con jardín en Cumbres');
    assert.match(q, /Título: CASA EN CUMBRES/i);
    assert.match(q, /Zona: Cumbres/i);
    assert.match(q, /Descripción:/i);
  });

  it('S3-R01 — código LUX en texto → fallback_legacy (path legacy)', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';
    const out = await ragInventory.resolveInboundPropertyReference({}, { text: 'info de LUX-A0470' });
    assert.equal(out.status, 'fallback_legacy');
  });

  it('S3-R02 — match semántico top-1 publicable → found', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    const chunk = {
      id: 'ch-1',
      source_type: 'property',
      source_id: 'p-1',
      similarity: 0.91,
      is_active: true,
      visibility_scope: 'public',
      content: 'LUX: LUX-A0470 · Casa en Mitras',
      metadata: { property_id: 'p-1', listing_id: 'LUX-A0470' },
    };

    ragService.semanticSearch = async () => ({
      chunks: [chunk],
      fallback: false,
      latency_ms: 120,
      query_hash: 'hash1',
      cache_hit: false,
    });

    const row = {
      id: 'p-1',
      listing_id: 'LUX-A0470',
      title: 'Casa Mitras',
      is_public: true,
      slug: 'casa-mitras',
      operation_type: 'sale',
      price: 1000000,
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
      rpc: async () => ({ data: [], error: null }),
    };

    const out = await ragInventory.resolveInboundPropertyReference(db, { text: 'casa en mitras', canaryPhone: '5218181877351' });
    assert.equal(out.status, 'found');
    assert.equal(out.propertyId, 'p-1');
    assert.equal(out.match_method, 'rag_semantic');
  });

  it('S3-R22 — propiedad oculta → fallback_legacy', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    const chunk = {
      id: 'ch-2',
      source_type: 'property',
      similarity: 0.95,
      is_active: true,
      visibility_scope: 'public',
      content: 'LUX: LUX-HIDDEN',
      metadata: { listing_id: 'LUX-HIDDEN' },
    };

    ragService.semanticSearch = async () => ({
      chunks: [chunk],
      fallback: false,
      latency_ms: 80,
      query_hash: 'h2',
    });

    const db = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          limit() { return this; },
          async maybeSingle() {
            return {
              data: { id: 'h1', listing_id: 'LUX-HIDDEN', is_public: false, visible_on_website: false },
              error: null,
            };
          },
        };
      },
    };

    const out = await ragInventory.resolveInboundPropertyReference(db, { text: 'propiedad oculta', canaryPhone: '5218181877351' });
    assert.equal(out.status, 'fallback_legacy');
    assert.equal(out.reason, 'hidden_or_inactive');
  });

  it('S3-R24 — RPC fail → fallback_legacy sin error usuario', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    ragService.semanticSearch = async () => ({
      chunks: [],
      fallback: true,
      latency_ms: 50,
      query_hash: 'h3',
    });

    const out = await ragInventory.resolveInboundPropertyReference({}, { text: 'casa', canaryPhone: '5218181877351' });
    assert.equal(out.status, 'fallback_legacy');
  });

  it('S3-R07 — ambiguous cuando gap pequeño entre top-2', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    const chunks = [
      {
        id: 'c1',
        source_type: 'property',
        similarity: 0.88,
        is_active: true,
        visibility_scope: 'public',
        content: 'LUX: LUX-A0001',
        metadata: { listing_id: 'LUX-A0001', property_id: 'p1' },
      },
      {
        id: 'c2',
        source_type: 'property',
        similarity: 0.86,
        is_active: true,
        visibility_scope: 'public',
        content: 'LUX: LUX-A0002',
        metadata: { listing_id: 'LUX-A0002', property_id: 'p2' },
      },
    ];

    ragService.semanticSearch = async () => ({
      chunks,
      fallback: false,
      latency_ms: 90,
      query_hash: 'h4',
    });

    const publishableRow = (id, code) => ({
      id,
      listing_id: code,
      is_public: true,
      title: code,
      slug: code.toLowerCase(),
      operation_type: 'sale',
      price: 1,
    });

    const db = {
      from() {
        return {
          select() { return this; },
          eq(_col, val) {
            this._val = val;
            return this;
          },
          limit() { return this; },
          async maybeSingle() {
            if (this._val === 'p1') return { data: publishableRow('p1', 'LUX-A0001'), error: null };
            if (this._val === 'p2') return { data: publishableRow('p2', 'LUX-A0002'), error: null };
            if (this._val === 'LUX-A0001') return { data: publishableRow('p1', 'LUX-A0001'), error: null };
            if (this._val === 'LUX-A0002') return { data: publishableRow('p2', 'LUX-A0002'), error: null };
            return { data: null, error: null };
          },
        };
      },
    };

    const out = await ragInventory.resolveInboundPropertyReference(db, { text: 'esa casa bonita', canaryPhone: '5218181877351' });
    assert.equal(out.status, 'ambiguous');
    assert.ok(out.candidates.length >= 2);
  });
});

describe('propertyInventoryService — RAG branch Sprint 3', () => {
  beforeEach(() => {
    delete process.env.RAG_P0_ENABLED;
    delete process.env.RAG_INVENTORY_ENABLED;
    delete process.env.RAG_P0_ALLOWLIST;
    ragService.semanticSearch = originalSemanticSearch;
  });

  afterEach(() => {
    ragService.semanticSearch = originalSemanticSearch;
  });

  it('S3-R25 — RAG OFF: resolveInboundPropertyReference sin código usa legacy (mock)', async () => {
    const db = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          ilike() { return this; },
          limit() { return this; },
          async maybeSingle() { return { data: null, error: null }; },
        };
      },
    };
    const out = await inv.resolveInboundPropertyReference(
      db,
      { text: 'Terreno en Privada Renacimiento y opciones relacionadas.' },
      console
    );
    assert.equal(out.status, 'not_found');
  });

  it('S3-R01 — código directo resuelve sin RAG aunque flags ON', async () => {
    process.env.RAG_P0_ENABLED = 'true';
    process.env.RAG_INVENTORY_ENABLED = 'true';
    process.env.RAG_P0_ALLOWLIST = '5218181877351';

    const row = {
      id: 'p-code',
      listing_id: 'LUX-A0123',
      title: 'Test',
      is_public: true,
      slug: 'test',
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

    let ragCalled = false;
    ragService.semanticSearch = async () => {
      ragCalled = true;
      return { chunks: [], fallback: true };
    };

    const out = await inv.resolveInboundPropertyReference(db, { code: 'LUX-A0123' }, console);
    assert.equal(out.status, 'found');
    assert.equal(out.propertyId, 'p-code');
    assert.equal(ragCalled, false);
  });
});
