'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPautaConversation,
  resolvePautaPropertyCrmContext,
  resolvePropertyEntryV3Eligibility,
  isPropertyEntryAutoPrimaryEnabled,
} = require('../conversation/pautaDetection');

test('isPautaConversation: campaign_context con property_code', () => {
  assert.equal(
    isPautaConversation({ campaign_context: { property_code: 'LUX-A0453' } }),
    true
  );
});

test('isPautaConversation: whatsapp_referral válido', () => {
  assert.equal(
    isPautaConversation({ whatsapp_referral: { ad_id: '123', source_type: 'ad' } }),
    true
  );
});

test('isPautaConversation: vacío → false', () => {
  assert.equal(isPautaConversation({}), false);
  assert.equal(isPautaConversation({ whatsapp_referral: {} }), false);
});

test('resolvePautaPropertyCrmContext: property_code + campaign → bypassEligible', () => {
  const ctx = resolvePautaPropertyCrmContext({
    campaign_context: { property_code: 'LUX-A0453' },
    property_code: 'LUX-A0453',
    property_specific_intent: true,
    direct_property_reference: true,
  });
  assert.equal(ctx.bypassEligible, true);
  assert.equal(ctx.propertyCode, 'LUX-A0453');
});

test('resolvePautaPropertyCrmContext: demand genérico sin propiedad → false', () => {
  const ctx = resolvePautaPropertyCrmContext({
    lead_flow: 'demand',
    location_text: 'San Pedro',
  });
  assert.equal(ctx.bypassEligible, false);
});

test('resolvePropertyEntryV3Eligibility: pauta con property_code → eligible', () => {
  const r = resolvePropertyEntryV3Eligibility({
    aiState: {
      campaign_context: { property_code: 'LUX-A0453' },
      property_code: 'LUX-A0453',
      property_specific_intent: true,
    },
    text: 'Hola',
  });
  assert.equal(r.eligible, true);
  assert.equal(r.reason, 'pauta_property');
});

test('resolvePropertyEntryV3Eligibility: genérico → not eligible', () => {
  const r = resolvePropertyEntryV3Eligibility({ aiState: {}, text: 'Hola' });
  assert.equal(r.eligible, false);
});

test('isPropertyEntryAutoPrimaryEnabled: flag true', () => {
  const prev = process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY;
  process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = 'true';
  delete require.cache[require.resolve('../conversation/pautaDetection')];
  const mod = require('../conversation/pautaDetection');
  assert.equal(mod.isPropertyEntryAutoPrimaryEnabled(), true);
  process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = prev;
});
