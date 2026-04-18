// utils/helpers.js

function nowIso() {
  return new Date().toISOString();
}

function uniq(list = []) {
  return [...new Set((list || []).filter((item) => item !== undefined && item !== null))];
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return '{}';
  }
}

function sanitizeReply(text) {
  if (!text) return '';

  let cleaned = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Evitar respuestas exageradamente largas para WhatsApp
  if (cleaned.length > 3500) {
    cleaned = `${cleaned.slice(0, 3497)}...`;
  }

  return cleaned;
}

function formatPrice(price, currency = 'MXN') {
  if (price == null || price === '') return null;

  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(price));
  } catch (error) {
    return `${currency} ${price}`;
  }
}

function getPublicPropertyUrl(property) {
  if (!property) return null;

  if (
    property.canonical_url &&
    /^https:\/\/luxetty\.com/i.test(property.canonical_url)
  ) {
    return property.canonical_url;
  }

  if (
    property.listing_url &&
    /^https:\/\/luxetty\.com/i.test(property.listing_url)
  ) {
    return property.listing_url;
  }

  if (property.slug) {
    return `https://luxetty.com/propiedad/${property.slug}`;
  }

  return null;
}

function formatPropertySummary(property) {
  if (!property) return '';

  const lines = [];

  if (property.listing_id) {
    lines.push(`ID: ${property.listing_id}`);
  }

  if (property.title) {
    lines.push(property.title);
  }

  const locationParts = [
    property.neighborhood,
    property.zone,
    property.city,
  ].filter(Boolean);

  if (locationParts.length) {
    lines.push(locationParts.join(', '));
  }

  if (property.price != null) {
    lines.push(formatPrice(property.price, property.currency_code || 'MXN'));
  }

  const featureParts = [];
  if (property.bedrooms != null && property.bedrooms !== 0) {
    featureParts.push(`${property.bedrooms} rec`);
  }
  if (property.bathrooms != null && property.bathrooms !== 0) {
    featureParts.push(`${property.bathrooms} baños`);
  }
  if (property.parking_spaces != null && property.parking_spaces !== 0) {
    featureParts.push(`${property.parking_spaces} est.`);
  }

  if (featureParts.length) {
    lines.push(featureParts.join(' · '));
  }

  const publicUrl = getPublicPropertyUrl(property);
  if (publicUrl) {
    lines.push(publicUrl);
  }

  return lines.join('\n');
}

module.exports = {
  nowIso,
  uniq,
  safeJsonStringify,
  sanitizeReply,
  formatPrice,
  getPublicPropertyUrl,
  formatPropertySummary,
};