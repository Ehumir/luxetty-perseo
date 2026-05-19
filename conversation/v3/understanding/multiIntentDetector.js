'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * @param {string} text
 * @returns {string[]}
 */
function detectSegmentIntents(text) {
  const t = normalizeText(text);
  const intents = [];
  if (/\b(vend|venta|vender|vendo|rentar\s+mi|rento\s+mi)\b/.test(t)) intents.push('offer');
  if (
    /\b(busco|compro|comprar|quiero\s+casa|necesito\s+casa|rentar\s+(?:una|depa|casa)|tienen\s+casas|hay\s+casas)\b/.test(
      t,
    )
  ) {
    intents.push('demand');
  }
  if (/\bLUX[-_]?\w+\d+/i.test(text)) intents.push('property');
  if (!intents.length) intents.push('unknown');
  return intents;
}

module.exports = {
  detectSegmentIntents,
};
