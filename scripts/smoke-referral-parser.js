/*
 * Smoke test for WhatsApp referral extraction.
 *
 * Run:
 *   node scripts/smoke-referral-parser.js
 */

const { extractWhatsAppReferral } = require('../utils/helpers');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const payloadWithReferral = {
    id: 'wamid.HBgLMQ==',
    from: '5218112345678',
    type: 'text',
    text: { body: 'Hola' },
    referral: {
      source_url: 'https://www.facebook.com/ads/example',
      source_type: 'ad',
      source_id: '1200123000',
      headline: 'Departamento en San Pedro',
      body: 'Agenda tu visita hoy',
      media_type: 'image',
      image_url: 'https://cdn.example.com/image.jpg',
      thumbnail_url: 'https://cdn.example.com/thumb.jpg',
      ctwa_clid: 'clid-123',
      ad_id: 'ad-001',
      ad_name: 'Ad Torre Kyo',
      campaign_id: 'cmp-001',
      campaign_name: 'Campana Venta SP',
    },
  };

  const parsedWithReferral = extractWhatsAppReferral(payloadWithReferral);
  assert(parsedWithReferral !== null, 'Expected referral to be detected');
  assert(parsedWithReferral.source_url === 'https://www.facebook.com/ads/example', 'Expected source_url');
  assert(parsedWithReferral.ad_id === 'ad-001', 'Expected ad_id');
  assert(parsedWithReferral.campaign_name === 'Campana Venta SP', 'Expected campaign_name');

  const payloadWithoutReferral = {
    id: 'wamid.HBgLMQ2==',
    from: '5218112345678',
    type: 'text',
    text: { body: 'Sin referral' },
  };

  const parsedWithoutReferral = extractWhatsAppReferral(payloadWithoutReferral);
  assert(parsedWithoutReferral === null, 'Expected null when referral is absent');

  const payloadWithIncompleteReferral = {
    id: 'wamid.HBgLMQ3==',
    from: '5218112345678',
    type: 'text',
    text: { body: 'Referral incompleto' },
    referral: {
      source_url: 'https://example.com/ad',
      ctwa_clid: 'clid-incomplete',
    },
  };

  const parsedIncompleteReferral = extractWhatsAppReferral(payloadWithIncompleteReferral);
  assert(parsedIncompleteReferral !== null, 'Expected referral object for incomplete referral');
  assert(parsedIncompleteReferral.source_url === 'https://example.com/ad', 'Expected source_url for incomplete referral');
  assert(parsedIncompleteReferral.ctwa_clid === 'clid-incomplete', 'Expected ctwa_clid for incomplete referral');
  assert(parsedIncompleteReferral.headline == null, 'Expected missing fields to remain absent');

  console.log('PASS referral parser smoke');
}

main();
