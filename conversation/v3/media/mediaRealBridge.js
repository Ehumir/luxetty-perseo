'use strict';

const { cleanSpaces } = require('../../../utils/text');
const { isMediaRealV1Enabled } = require('../../../config/perseoM302Flags');
const { LOW_CONFIDENCE_THRESHOLD } = require('./mediaIntakeV1');

/**
 * Resolves inbound media to V3 intake shape. Production may call Whisper/Vision async
 * before V3; ARGOS passes deterministic provider payloads.
 *
 * @param {object|null} media
 * @param {{ deterministic?: boolean, transcribeFn?: Function, analyzeImageFn?: Function }} [opts]
 */
function resolveMediaForIntake(media, opts = {}) {
  if (!media || typeof media !== 'object' || !media.kind) return media;
  if (!isMediaRealV1Enabled() && !media.force_real) return media;

  const deterministic = opts.deterministic === true || media.provider === 'argos_deterministic';

  if (media.kind === 'audio') {
    if (media.transcript != null || media.no_transcript === true) return media;
    if (deterministic && media.simulate_transcript != null) {
      return {
        ...media,
        transcript: cleanSpaces(media.simulate_transcript),
        confidence: Number(media.simulate_confidence ?? 0.9),
        provider: 'argos_deterministic',
      };
    }
    if (typeof opts.transcribeFn === 'function' && media.audio_ref) {
      const out = opts.transcribeFn(media);
      if (out && typeof out.then === 'function') {
        return media;
      }
      return mapTranscriptionToMedia(media, out);
    }
    return media;
  }

  if (media.kind === 'image' || media.kind === 'screenshot') {
    const kind = 'image';
    if (Array.isArray(media.hints) && media.hints.length) {
      return { ...media, kind, provider: media.provider || 'pre_resolved' };
    }
    if (deterministic && Array.isArray(media.simulate_hints)) {
      return {
        ...media,
        kind,
        hints: media.simulate_hints,
        provider: 'argos_deterministic',
        hints_are_non_authoritative: true,
      };
    }
    if (typeof opts.analyzeImageFn === 'function' && media.image_ref) {
      const out = opts.analyzeImageFn(media);
      if (out && typeof out.then === 'function') return { ...media, kind };
      return mapVisionToMedia(media, out, kind);
    }
    return { ...media, kind };
  }

  if (media.kind === 'document' || media.kind === 'pdf') {
    const text = cleanSpaces(media.extracted_text || media.simulate_text || '');
    return {
      ...media,
      kind: media.kind,
      extracted_text: text || null,
      confidence: Number(media.confidence ?? (text ? 0.85 : 0)),
      provider: media.provider || (text ? 'argos_deterministic' : null),
    };
  }

  return media;
}

/**
 * Async resolver for production webhook path (Whisper / Vision).
 * @param {object|null} media
 * @param {{ deterministic?: boolean, transcribeFn?: Function, analyzeImageFn?: Function }} [opts]
 */
async function resolveMediaForIntakeAsync(media, opts = {}) {
  if (!media || typeof media !== 'object' || !media.kind) return media;
  if (!isMediaRealV1Enabled() && !media.force_real) return media;

  const deterministic = opts.deterministic === true || media.provider === 'argos_deterministic';
  if (deterministic) return resolveMediaForIntake(media, opts);

  if (media.kind === 'audio' && typeof opts.transcribeFn === 'function' && media.audio_ref) {
    try {
      const out = await opts.transcribeFn(media);
      return mapTranscriptionToMedia(media, out);
    } catch (_err) {
      return {
        ...media,
        no_transcript: true,
        provider: 'openai_failed',
        fallback_reason: 'media_provider_error',
        media_authoritative: false,
      };
    }
  }

  if (
    (media.kind === 'image' || media.kind === 'screenshot') &&
    typeof opts.analyzeImageFn === 'function' &&
    media.image_ref
  ) {
    try {
      const out = await opts.analyzeImageFn(media);
      return mapVisionToMedia(media, out, 'image');
    } catch (_err) {
      return {
        ...media,
        kind: 'image',
        illegible: true,
        provider: 'openai_failed',
        fallback_reason: 'media_provider_error',
        media_authoritative: false,
      };
    }
  }

  return resolveMediaForIntake(media, opts);
}

function mapTranscriptionToMedia(media, result) {
  const text = cleanSpaces(
    result?.transcription_text || result?.transcript || result?.text || '',
  );
  if (!result || result.success === false || !text) {
    return {
      ...media,
      no_transcript: true,
      provider: result?.provider || 'openai',
      media_authoritative: false,
    };
  }
  const confidence = Number(result.confidence_score ?? result.confidence ?? 0.7);
  return {
    ...media,
    transcript: text,
    confidence,
    provider: result.provider || 'openai',
    needs_confirmation: confidence < LOW_CONFIDENCE_THRESHOLD,
    media_authoritative: false,
    requires_confirmation: confidence < LOW_CONFIDENCE_THRESHOLD,
  };
}

function mapVisionToMedia(media, result, kind) {
  if (!result || result.success === false) {
    return { ...media, kind, illegible: true, provider: result?.provider || 'openai' };
  }
  const hints = Array.isArray(result.hints)
    ? result.hints
    : Array.isArray(result.visual_hints)
      ? result.visual_hints.map((h) => ({
          hint: cleanSpaces(h.hint || h.label || h.type || ''),
          confidence: Number(h.confidence ?? 0.5),
        }))
      : [];
  if (!hints.length && result.summary) {
    hints.push({ hint: cleanSpaces(result.summary).slice(0, 120), confidence: 0.55 });
  }
  return {
    ...media,
    kind,
    hints,
    provider: result.provider || 'openai',
    hints_are_non_authoritative: true,
  };
}

module.exports = {
  resolveMediaForIntake,
  resolveMediaForIntakeAsync,
  mapTranscriptionToMedia,
  mapVisionToMedia,
};
