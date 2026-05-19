'use strict';

const { isMediaHardeningEnabled, getMaxInboundPayloadBytes } = require('../../../config/perseoM403Flags');
const { recordMetric } = require('./observability/runtimeMetricsCollector');

const ALLOWED_MIME_PREFIXES = [
  'audio/',
  'image/',
  'application/pdf',
  'text/plain',
];

const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function normalizeMime(mime) {
  return String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
}

function isMimeAllowed(mime) {
  const m = normalizeMime(mime);
  if (!m) return true;
  if (ALLOWED_MIME_EXACT.has(m)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

/**
 * Validate inbound media before expensive processing. Never throws — returns verdict.
 */
function validateInboundMedia(media, opts = {}) {
  if (!media || typeof media !== 'object') {
    return { ok: true, skipped: true };
  }
  if (!isMediaHardeningEnabled() && !opts.force) {
    return { ok: true, mode: 'disabled' };
  }

  const byteSize = Number(media.byte_size || media.size || opts.byteSize || 0);
  const maxBytes = getMaxInboundPayloadBytes();
  if (byteSize > maxBytes) {
    recordMetric('media_reject', { reason: 'payload_too_large' });
    return {
      ok: false,
      reject_reason: 'payload_too_large',
      fallback_reason: 'media_payload_rejected',
      user_hint: 'El archivo es demasiado grande; cuéntame en texto qué necesitas.',
      media_authoritative: false,
    };
  }

  const mime = normalizeMime(media.mime_type);
  if (mime && !isMimeAllowed(mime)) {
    recordMetric('media_reject', { reason: 'unsupported_mime' });
    return {
      ok: false,
      reject_reason: 'unsupported_mime',
      fallback_reason: 'unsupported_mime',
      user_hint: 'No puedo procesar ese tipo de archivo; escríbeme en texto.',
      media_authoritative: false,
    };
  }

  if (media.corrupt === true || media.malformed === true) {
    recordMetric('media_reject', { reason: 'malformed' });
    return {
      ok: false,
      reject_reason: 'malformed',
      fallback_reason: 'media_malformed',
      media_authoritative: false,
    };
  }

  if (media.kind === 'audio' && media.corrupt_audio === true) {
    return {
      ok: false,
      reject_reason: 'corrupt_audio',
      no_transcript: true,
      fallback_reason: 'corrupt_audio',
      media_authoritative: false,
    };
  }

  return { ok: true, mode: 'validated' };
}

function applyMediaHardeningToMedia(media, opts = {}) {
  const verdict = validateInboundMedia(media, opts);
  if (verdict.ok) return { media, verdict };
  return {
    media: {
      ...media,
      ...verdict,
      fail_open_applied: true,
    },
    verdict,
  };
}

module.exports = {
  validateInboundMedia,
  applyMediaHardeningToMedia,
  isMimeAllowed,
  normalizeMime,
};
