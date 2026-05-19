'use strict';

/**
 * Inventario determinista para ARGOS (sin Supabase).
 * Códigos alineados con tests v3F33 / propertySpecificFlow.
 */
const PROPERTY_FIXTURES = {
  'LUX-A0470': {
    id: 'argos-fixture-lux-a0470',
    code: 'LUX-A0470',
    price_label: '$6,500,000 MXN',
    price: 6500000,
    public_url: 'https://luxetty.com/propiedad/lux-a0470',
    location_label: 'Cumbres',
    is_active: true,
    is_published: true,
  },
  'LUX-A0461': {
    id: 'argos-fixture-lux-a0461',
    code: 'LUX-A0461',
    price_label: '$5,200,000 MXN',
    price: 5200000,
    public_url: 'https://luxetty.com/propiedad/lux-a0461',
    location_label: 'Valle Oriente',
    is_active: true,
    is_published: true,
  },
  'LUX-A0462': {
    id: 'argos-fixture-lux-a0462',
    code: 'LUX-A0462',
    price_label: '$6,500,000 MXN',
    price: 6500000,
    public_url: 'https://luxetty.com/propiedad/lux-a0462',
    location_label: 'Zona norte',
    is_active: true,
    is_published: true,
  },
};

function normalizeFixtureCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/_/g, '-');
}

/**
 * @param {string} code
 */
function getPropertyFixture(code) {
  const norm = normalizeFixtureCode(code);
  return PROPERTY_FIXTURES[norm] || null;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractFixtureCodesFromText(text) {
  const { extractListingCodes } = require('./mustNotValidator');
  const codes = extractListingCodes(text);
  return codes.filter((c) => getPropertyFixture(c));
}

/**
 * @param {{ setup?: object, text?: string }} input
 * @returns {{ propertyListingCode?: string, activeProperty?: object }|null}
 */
function resolveArgosLegacyHydration(input) {
  const setup = input.setup && typeof input.setup === 'object' ? input.setup : {};
  const fromText = extractFixtureCodesFromText(input.text || '');
  const fromSetupList = Array.isArray(setup.property_fixtures)
    ? setup.property_fixtures.map(normalizeFixtureCode).filter(Boolean)
    : [];
  const persisted = input.persistedPropertyCode
    ? normalizeFixtureCode(input.persistedPropertyCode)
    : null;
  const code =
    fromText[fromText.length - 1] ||
    (persisted && getPropertyFixture(persisted) ? persisted : null) ||
    fromSetupList[fromSetupList.length - 1] ||
    null;
  if (!code) return null;
  const fixture = getPropertyFixture(code);
  if (!fixture) return { propertyListingCode: code, activeProperty: null };
  return {
    propertyListingCode: fixture.code,
    activeProperty: { ...fixture },
  };
}

module.exports = {
  PROPERTY_FIXTURES,
  getPropertyFixture,
  normalizeFixtureCode,
  extractFixtureCodesFromText,
  resolveArgosLegacyHydration,
};
