function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getPublicPropertyUrl(property) {
  if (!property) return null;

  if (
    property.listing_url &&
    /^https:\/\/luxetty\.com/i.test(property.listing_url)
  ) {
    return property.listing_url;
  }

  if (
    property.canonical_url &&
    /^https:\/\/luxetty\.com/i.test(property.canonical_url) &&
    !property.canonical_url.includes('supabase.co/storage') &&
    !property.canonical_url.includes('/storage/v1/object/public/')
  ) {
    return property.canonical_url;
  }

  if (property.slug) {
    return `https://luxetty.com/propiedad/${property.slug}`;
  }

  return null;
}

function sanitizeReply(reply) {
  return (reply || '')
    .replace(/https?:\/\/[^\s]*supabase[^\s]*/gi, '')
    .replace(/https?:\/\/[^\s]*storage[^\s]*/gi, '')
    .replace(/https?:\/\/(?!luxetty\.com)[^\s]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  uniq,
  safeJsonStringify,
  nowIso,
  getPublicPropertyUrl,
  sanitizeReply,
};