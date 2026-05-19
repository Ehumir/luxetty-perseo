'use strict';

const { normalizeLocationFromUserText } = require('../interpreter/locationNormalizer');
const { parsePolicyMoney } = require('../policy/policyMoney');

/**
 * @param {{ text: string, intents: string[] }} segment
 */
function extractSegmentSlots(segment) {
  const text = String(segment.text || '');
  const intents = segment.intents || [];
  const money = parsePolicyMoney(text);
  const locationText = normalizeLocationFromUserText(text) || extractInlineZone(text);
  const isOffer = intents.includes('offer');
  const isDemand = intents.includes('demand');

  const slots = {
    money,
    locationText,
    zone: locationText,
    leadFlow: isOffer ? 'offer' : isDemand ? 'demand' : null,
    operationType: money?.operationType || (isOffer ? 'sale' : isDemand ? 'sale' : null),
  };

  if (isOffer && money?.amount != null) {
    slots.expectedPrice = money.amount;
  }
  if (isDemand && money?.amount != null) {
    slots.budget = money.amount;
  }

  return slots;
}

function extractInlineZone(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('cumbres')) return 'Cumbres';
  if (/\bsan\s+pedro\b/.test(t)) return 'San Pedro';
  if (/\bcarretera\s+nacional\b/.test(t)) return 'Carretera Nacional';
  if (t.includes('monterrey centro') || t.includes('centro de monterrey')) return 'Monterrey centro';
  return null;
}

/**
 * @param {{ text: string, index: number, intents?: string[] }[]} segments
 */
function extractAllSegmentSlots(segments) {
  return segments.map((seg) => {
    const intents = seg.intents || [];
    const slots = extractSegmentSlots({ text: seg.text, intents });
    return { ...seg, intents, slots };
  });
}

module.exports = {
  extractSegmentSlots,
  extractAllSegmentSlots,
  extractInlineZone,
};
