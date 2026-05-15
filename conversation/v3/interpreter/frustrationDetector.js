'use strict';

const { normalizeText } = require('../../../utils/text');
const { FRUSTRATION_STATES } = require('../types/constants');

function detectFrustration(text = '') {
  const t = normalizeText(String(text || ''));
  if (!t) return { isFrustrated: false, level: FRUSTRATION_STATES.NONE };
  const patterns = [
    /no me entiendes/,
    /no entiendes/,
    /por que hablas asi/,
    /por qué hablas así/,
    /hablas raro/,
    /hablas mal/,
    /no estas entendiendo/,
    /no estás entendiendo/,
    /que no entiendes/,
  ];
  for (const p of patterns) {
    if (p.test(t)) return { isFrustrated: true, level: FRUSTRATION_STATES.ELEVATED };
  }
  return { isFrustrated: false, level: FRUSTRATION_STATES.NONE };
}

module.exports = {
  detectFrustration,
};
