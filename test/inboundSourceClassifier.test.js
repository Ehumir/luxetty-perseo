'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPerseoInboundSource,
  applyInboundSourceToAiState,
} = require('../conversation/inboundSourceClassifier');

const META_REFERRAL_PAYLOAD = {
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                type: 'text',
                text: { body: 'Me interesa' },
                referral: {
                  source_type: 'ad',
                  source_url: 'https://fb.me/abc123',
                  ad_id: 'ad-998877',
                  campaign_id: 'camp-554433',
                  ctwa_clid: 'clid-xyz',
                  headline: 'Casa en Cumbres',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('classifyPerseoInboundSource — AG-C', () => {
  it('1. mensaje de campaña con metadata real → meta_campaign high', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Me interesa',
      rawPayload: META_REFERRAL_PAYLOAD,
    });
    assert.equal(result.sourceType, 'meta_campaign');
    assert.equal(result.confidence, 'high');
    assert.ok(result.campaignMetadata?.ad_id);
  });

  it('2. mensaje landing prefabricado Cumbres → landing_whatsapp', () => {
    const result = classifyPerseoInboundSource({
      messageText:
        'Hola Luxetty. Me interesa una prevaluación. Tengo una propiedad en Cumbres o zona poniente y quiero recibir una prevaluación comercial inicial.',
    });
    assert.equal(result.sourceType, 'landing_whatsapp');
    assert.equal(result.confidence, 'high');
    assert.ok(result.landingContext?.landing_key === 'cumbres_supply');
  });

  it('3. mensaje con código de propiedad → property_whatsapp', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Me interesa LUX-A0470. ¿Sigue disponible?',
    });
    assert.equal(result.sourceType, 'property_whatsapp');
    assert.equal(result.propertyContext?.property_code, 'LUX-A0470');
  });

  it('4. mensaje directo sin metadata → organic_direct', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Hola',
    });
    assert.equal(result.sourceType, 'organic_direct');
    assert.ok(result.organicReason);
    assert.equal(result.campaignMetadata, null);
  });

  it('5. "Info" sin contexto no inventa campaña', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Info',
    });
    assert.notEqual(result.sourceType, 'meta_campaign');
    assert.equal(result.campaignMetadata, null);
  });

  it('6. "Vi su anuncio" sin metadata → low confidence, no meta_campaign', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Vi su anuncio',
    });
    assert.notEqual(result.sourceType, 'meta_campaign');
    assert.equal(result.confidence, 'low');
    assert.ok(result.missingEvidence.includes('ad_reference_without_metadata'));
  });

  it('7. valoración inicial Cumbres → landing_whatsapp captación', () => {
    const result = classifyPerseoInboundSource({
      messageText:
        'Hola Luxetty, acabo de solicitar una valoración inicial para mi propiedad en Cumbres.',
    });
    assert.equal(result.sourceType, 'landing_whatsapp');
  });

  it('8. broker externo → portal_broker', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Soy asesor inmobiliario, tengo cliente para esa propiedad. ¿Comparten comisión?',
    });
    assert.equal(result.sourceType, 'portal_broker');
    assert.equal(result.confidence, 'high');
  });

  it('9. metadata existente no se sobrescribe con null en applyInboundSourceToAiState', () => {
    const existing = {
      campaign_context: { campaign_id: 'keep-me', headline: 'Original' },
      whatsapp_referral: { ad_id: 'existing-ad' },
    };
    const next = applyInboundSourceToAiState(existing, {
      messageText: 'Hola',
      aiState: existing,
    });
    assert.equal(next.campaign_context.campaign_id, 'keep-me');
    assert.equal(next.whatsapp_referral.ad_id, 'existing-ad');
    assert.ok(next.inbound_source);
  });

  it('10. bridge token → intake_bridge', () => {
    const token = 'a'.repeat(32);
    const result = classifyPerseoInboundSource({
      messageText: `Hola, completé el formulario intake=${token}`,
    });
    assert.equal(result.sourceType, 'intake_bridge');
    assert.equal(result.confidence, 'high');
  });

  it('11. captación malbaratar propiedad → landing_whatsapp', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'No quiero malbaratar mi propiedad.',
    });
    assert.equal(result.sourceType, 'landing_whatsapp');
  });

  it('12. quiero verla → property_whatsapp medium', () => {
    const result = classifyPerseoInboundSource({
      messageText: 'Quiero verla.',
    });
    assert.equal(result.sourceType, 'property_whatsapp');
    assert.equal(result.confidence, 'medium');
  });
});
