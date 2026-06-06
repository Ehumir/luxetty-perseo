'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('evaluateV3PrimaryGate (F2 hotfix)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete require.cache[require.resolve('../config/perseoV3Flags')];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  function load() {
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    return require('../config/perseoV3Flags');
  }

  function setupAllowlist() {
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
    process.env.PERSEO_ENGINE = 'legacy';
  }

  it('no requiere PERSEO_ENGINE=v3 para primary', () => {
    setupAllowlist();
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5218119086196' });
    assert.equal(g.v3_requires_perseo_engine_v3, false);
    assert.equal(g.v3_engine_requested, 'legacy');
    assert.equal(g.v3_primary_allowed, true);
    assert.equal(g.route, 'v3_primary');
  });

  it('match inbound Meta MX 521… con allowlist dígitos', () => {
    setupAllowlist();
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({
      phone: '5218119086196',
      rawPhone: '5218119086196',
    });
    assert.equal(g.allowlist_match, true);
    assert.equal(g.inbound_normalized, '5218119086196');
  });

  it('match desde raw 10 dígitos locales', () => {
    setupAllowlist();
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '8119086196' });
    assert.equal(g.inbound_normalized, '5218119086196');
    assert.equal(g.allowlist_match, true);
  });

  it('match desde raw 52 + 10 dígitos', () => {
    setupAllowlist();
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '528119086196' });
    assert.equal(g.inbound_normalized, '5218119086196');
    assert.equal(g.allowlist_match, true);
  });

  it('match allowlist con espacios y + (una entrada)', () => {
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '+52 81 1908 6196';
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5218119086196' });
    assert.equal(g.allowlist_match, true, g.v3_primary_block_reason);
  });

  it('match allowlist solo 10 dígitos locales', () => {
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '8119086196';
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5218119086196' });
    assert.equal(g.allowlist_match, true);
  });

  it('no match número fuera de allowlist', () => {
    setupAllowlist();
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5219999999999' });
    assert.equal(g.allowlist_match, false);
    assert.equal(g.v3_primary_block_reason, 'allowlist_no_match');
    assert.equal(g.route, 'legacy_primary');
  });

  it('no match por suffix parcial (allowlist estricta Cuarzo)', () => {
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '9086196';
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5218119086196' });
    assert.equal(g.allowlist_match, false);
    assert.equal(g.v3_primary_block_reason, 'allowlist_no_match');
  });

  it('v3_disabled cuando PERSEO_V3_ENABLED no es true', () => {
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({ phone: '5218119086196' });
    assert.equal(g.v3_primary_block_reason, 'v3_disabled');
  });

  it('property entry bypass cuando flag ON y eligible (MC-6)', () => {
    setupAllowlist();
    process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = 'true';
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({
      phone: '5219998887777',
      propertyEntryEligible: true,
      propertyEntryBypassReason: 'pauta_property',
    });
    assert.equal(g.allowlist_match, false);
    assert.equal(g.v3_primary_allowed, true);
    assert.equal(g.v3_primary_bypass_reason, 'pauta_property');
    assert.equal(g.route, 'v3_primary');
  });

  it('property entry bypass OFF sin flag', () => {
    setupAllowlist();
    delete process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY;
    const { evaluateV3PrimaryGate } = load();
    const g = evaluateV3PrimaryGate({
      phone: '5219998887777',
      propertyEntryEligible: true,
    });
    assert.equal(g.v3_primary_block_reason, 'allowlist_no_match');
    assert.equal(g.v3_primary_allowed, false);
  });
});

describe('tryV3PrimaryReply (regresión async)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    delete require.cache[require.resolve('../conversation/v3/core/v3InboundBridge')];
    delete require.cache[require.resolve('../conversation/v3/core/v3Runtime')];
    delete require.cache[require.resolve('../conversation/v3/core/sessionStore')];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('retorna resultado con handled cuando allowlist match (async; index usa await)', async () => {
    const { tryV3PrimaryReply } = require('../conversation/v3/core/v3InboundBridge');
    const out = await tryV3PrimaryReply({
      conversationId: 'gate-sync-1',
      phone: '5218119086196',
      text: 'Hola',
    });
    assert.equal(out.handled, true);
    assert.equal(out.responseSource, 'v3_core_f2');
  });
});
