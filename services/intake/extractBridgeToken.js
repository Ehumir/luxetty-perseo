'use strict';

const BRIDGE_TOKEN_RE = /\b([a-f0-9]{32})\b/i;

/**
 * Extrae bridge_token APA desde texto WA, URL prefill o referral.
 * Formato: UUID sin guiones (32 hex), p.ej. query ?intake=
 */
function extractBridgeToken(input = {}) {
  const sources = [];

  if (typeof input === 'string') {
    sources.push(input);
  } else {
    const { text = '', referral = null, rawPayload = null } = input;
    if (text) sources.push(String(text));

    if (referral && typeof referral === 'object') {
      const refUrl =
        referral.source_url ||
        referral.sourceUrl ||
        referral.referral_url ||
        referral.url ||
        null;
      if (refUrl) sources.push(String(refUrl));
      if (referral.bridge_token) sources.push(String(referral.bridge_token));
      if (referral.intake) sources.push(String(referral.intake));
    }

    if (rawPayload && typeof rawPayload === 'object') {
      try {
        sources.push(JSON.stringify(rawPayload));
      } catch (_e) {
        /* ignore */
      }
    }
  }

  for (const raw of sources) {
    const decoded = safeDecodeURIComponent(String(raw || ''));
    const intakeParam = decoded.match(/(?:[?&#]|^|\s)intake=([a-f0-9]{32})\b/i);
    if (intakeParam?.[1]) return intakeParam[1].toLowerCase();

    const bridgeParam = decoded.match(/(?:bridge[_-]?token|bridge)=([a-f0-9]{32})\b/i);
    if (bridgeParam?.[1]) return bridgeParam[1].toLowerCase();

    const plain = decoded.match(BRIDGE_TOKEN_RE);
    if (plain?.[1] && /intake|bridge|luxetty/i.test(decoded)) {
      return plain[1].toLowerCase();
    }
  }

  return null;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (_e) {
    return value;
  }
}

module.exports = {
  extractBridgeToken,
  BRIDGE_TOKEN_RE,
};
