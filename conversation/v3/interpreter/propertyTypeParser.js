'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * @param {string} text
 * @returns {'house'|'apartment'|'land'|null}
 */
function parsePropertyType(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;
  if (t.includes('departamento') || t.includes('depto')) return 'apartment';
  if (t.includes('terreno')) return 'land';
  if (/\bcasa\b/.test(t) || t.includes('es casa') || t.includes('que es casa')) return 'house';
  return null;
}

function propertyTypeLabel(type) {
  if (type === 'house') return 'casa';
  if (type === 'apartment') return 'departamento';
  if (type === 'land') return 'terreno';
  return 'inmueble';
}

module.exports = {
  parsePropertyType,
  propertyTypeLabel,
};
