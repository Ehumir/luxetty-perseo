'use strict';

/**
 * M4-02 — WhatsApp webhook → V3 media (production path).
 * Media is NEVER authoritative alone — see docs/sprints/M4-02-media-non-authoritative.md
 */

const { cleanSpaces } = require('../utils/text');
const { isMediaRuntimeProductionEnabled } = require('../config/perseoM401Flags');
const { isMediaRuntimeFailOpenEnabled, getMediaTimeoutMs } = require('../config/perseoM402Flags');
const { isMediaRealV1Enabled } = require('../config/perseoM302Flags');
const { resolveMediaForIntakeAsync } = require('../conversation/v3/media/mediaRealBridge');
const { createMediaProductionAdapters } = require('../conversation/v3/runtime/mediaProduction');
const { getInboundMediaDescriptor, resolveInboundMedia } = require('./whatsappMediaService');

const FAIL_OPEN_USER_HINT =
  'No pude procesar el archivo por completo; si puedes, cuéntame en texto qué necesitas.';

function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ timed_out: true, label, ms });
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve({ timed_out: false, value: v });
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ timed_out: false, error: err });
      });
  });
}

function mapWhatsAppTypeToKind(type) {
  const t = String(type || 'text').toLowerCase();
  if (t === 'voice' || t === 'audio') return 'audio';
  if (t === 'image' || t === 'sticker') return 'image';
  if (t === 'document') return 'document';
  if (t === 'video') return 'video';
  return null;
}

/**
 * Build V3 media object from WhatsApp Cloud API message (no invented content).
 */
async function buildV3MediaFromWhatsAppMessage({ message, conversationId, messageId, logEvent }) {
  const kind = mapWhatsAppTypeToKind(message?.type);
  if (!kind) return { media: null, meta: { skipped: true, reason: 'text_only' } };

  const descriptor = getInboundMediaDescriptor(message);
  let buffer = null;
  let mimeType = descriptor?.mime_type || null;

  if (isMediaRuntimeProductionEnabled()) {
    try {
      const resolved = await resolveInboundMedia(message);
      buffer = resolved?.buffer || null;
      mimeType = resolved?.mimeType || mimeType;
    } catch (err) {
      if (typeof logEvent === 'function') {
        logEvent('media_v3_download_failed', {
          conversation_id: conversationId,
          kind,
          error: String(err?.message || err),
        });
      }
    }
  }

  const caption =
    cleanSpaces(
      message?.image?.caption ||
        message?.document?.caption ||
        message?.video?.caption ||
        message?.audio?.caption ||
        '',
    ) || '';

  const base = {
    kind,
    mime_type: mimeType,
    caption,
    audio_ref: kind === 'audio' ? descriptor?.media_id || 'wa_audio' : undefined,
    image_ref: kind === 'image' ? descriptor?.media_id || 'wa_image' : undefined,
    audio_buffer: kind === 'audio' ? buffer : undefined,
    image_buffer: kind === 'image' ? buffer : undefined,
    document_buffer: kind === 'document' ? buffer : undefined,
    filename: message?.document?.filename || null,
    media_authoritative: false,
    requires_confirmation: true,
  };

  return { media: base, meta: { kind, has_buffer: !!buffer } };
}

/**
 * Resolve media for V3 turn with timeouts + fail-open (timeout ≠ hard fail).
 */
async function resolveInboundMediaForV3Turn({ message, conversationId, messageId, logEvent }) {
  const mediaRealOn = isMediaRealV1Enabled() || isMediaRuntimeProductionEnabled();
  if (!mediaRealOn) {
    return { media: null, fallback_reason: null, fail_open: false };
  }

  const built = await buildV3MediaFromWhatsAppMessage({
    message,
    conversationId,
    messageId,
    logEvent,
  });
  if (!built.media) {
    return { media: null, fallback_reason: null, fail_open: false };
  }

  const kind = built.media.kind;
  const timeoutMs = getMediaTimeoutMs(kind === 'document' ? 'document' : kind);
  const adapters = createMediaProductionAdapters({
    conversationId,
    messageId,
    audioBuffer: built.media.audio_buffer,
    imageBuffer: built.media.image_buffer,
  });

  const raced = await withTimeout(
    resolveMediaForIntakeAsync(built.media, {
      deterministic: false,
      transcribeFn: adapters.transcribeFn,
      analyzeImageFn: adapters.analyzeImageFn,
      extractDocumentFn: adapters.extractDocumentFn,
    }),
    timeoutMs,
    kind,
  );

  if (raced.timed_out) {
    const failOpen = isMediaRuntimeFailOpenEnabled();
    if (typeof logEvent === 'function') {
      logEvent('media_v3_timeout', {
        conversation_id: conversationId,
        kind,
        timeout_ms: timeoutMs,
        fail_open: failOpen,
      });
    }
    return {
      media: {
        ...built.media,
        kind,
        media_timeout: true,
        fallback_reason: 'media_timeout',
        fail_open_applied: failOpen,
        user_hint: failOpen ? FAIL_OPEN_USER_HINT : null,
        media_authoritative: false,
      },
      fallback_reason: 'media_timeout',
      fail_open: failOpen,
    };
  }

  if (raced.error) {
    const failOpen = isMediaRuntimeFailOpenEnabled();
    return {
      media: {
        ...built.media,
        fallback_reason: 'media_provider_error',
        fail_open_applied: failOpen,
        user_hint: failOpen ? FAIL_OPEN_USER_HINT : null,
        media_authoritative: false,
      },
      fallback_reason: 'media_provider_error',
      fail_open: failOpen,
    };
  }

  const resolved = raced.value || built.media;
  return {
    media: {
      ...resolved,
      media_authoritative: false,
      requires_confirmation: true,
      hints_are_non_authoritative: resolved.hints_are_non_authoritative !== false,
    },
    fallback_reason: resolved.no_transcript
      ? 'no_transcript'
      : resolved.illegible
        ? 'illegible'
        : null,
    fail_open: false,
  };
}

module.exports = {
  FAIL_OPEN_USER_HINT,
  buildV3MediaFromWhatsAppMessage,
  resolveInboundMediaForV3Turn,
  withTimeout,
};
