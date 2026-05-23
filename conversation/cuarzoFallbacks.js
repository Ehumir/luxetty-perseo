'use strict';

/**
 * Cuarzo V1 — fallbacks honestos para capacidades fuera de alcance.
 * No afirma analizar lo que no puede; canaliza a humano cuando corresponde.
 */

const { cleanSpaces, normalizeText } = require('../utils/text');
const {
  buildOperationalHandoffSummary,
  buildStandardHandoffStatePatch,
} = require('./cuarzoHandoff');

const PENDING_VERSION = {
  multimedia: 'Amatista',
  audio_transcription: 'Amatista',
  document_pdf: 'Amatista',
  semantic_inventory: 'Topacio',
  pre_engine: 'Topacio',
};

function mediaKindLabel(kind = '') {
  const k = String(kind || '').toLowerCase();
  if (k === 'audio' || k === 'voice') return 'audio';
  if (k === 'document') return 'documento o PDF';
  if (k === 'image' || k === 'sticker') return 'imagen';
  if (k === 'video') return 'video';
  return 'archivo multimedia';
}

function buildHonestMediaFallback(kind) {
  const label = mediaKindLabel(kind);
  return `Soy el asistente IA de Luxetty. Por ahora no puedo analizar ${label}s en detalle por este chat. Si me cuentas en texto qué necesitas, te oriento; si prefieres, un asesor humano puede revisarlo contigo — solo dime "asesor".`;
}

function buildLegalFallback() {
  return 'Soy el asistente IA de Luxetty. Por la naturaleza legal de tu caso, lo canalizo con un asesor humano para que lo revisen contigo con cuidado. En breve te contactan por aquí.';
}

function buildAmbiguousIntentFallback() {
  return 'Soy el asistente IA de Luxetty. No me quedó claro si quieres seguir con compra, renta o venta. Para no confundirte, un asesor humano puede ayudarte mejor — ¿te parece si te contactan por aquí?';
}

function buildLocationUnparseableFallback() {
  return 'Soy el asistente IA de Luxetty. No pude ubicar bien la zona que mencionas. ¿Me la repites en colonia o municipio? Si prefieres, un asesor puede ayudarte — dime "asesor".';
}

function resolveCuarzoOutOfScopeTurn({
  text = '',
  parsedSignals = {},
  inboundContext = {},
  previousAiState = {},
  nextAiState = {},
} = {}) {
  if (previousAiState.handoff_sent || nextAiState.handoff_sent) {
    return { handled: false };
  }

  const merged = { ...previousAiState, ...nextAiState };
  const sig = parsedSignals && typeof parsedSignals === 'object' ? parsedSignals : {};
  const media = inboundContext?.media || sig.media || null;
  const mediaType = media?.type || media?.kind || null;

  // Legal delicado → handoff directo
  if (sig.legal_sensitive || merged.legal_sensitive) {
    const summary = buildOperationalHandoffSummary(
      { ...merged, legal_sensitive: true },
      {
        reason: 'legal_sensitive',
        userSnippet: cleanSpaces(String(text || '')),
        pendingVersion: PENDING_VERSION.pre_engine,
      },
    );
    return {
      handled: true,
      reply: buildLegalFallback(),
      statePatch: buildStandardHandoffStatePatch(summary, {
        legal_sensitive: true,
        last_change_type: 'cuarzo_legal_handoff',
      }),
      responseSource: 'cuarzo_legal_handoff',
      pending_version: 'Amatista',
    };
  }

  // Multimedia no texto sin procesamiento real
  if (mediaType && mediaType !== 'text' && !sig.media_processed && !media?.processed) {
    const summary = buildOperationalHandoffSummary(merged, {
      reason: 'multimedia_unprocessed',
      userSnippet: `[${mediaKindLabel(mediaType)}]`,
      pendingVersion: PENDING_VERSION.multimedia,
    });
    const escalate =
      mediaType === 'document' ||
      mediaType === 'audio' ||
      mediaType === 'voice' ||
      (sig.media_fallback_required === true);

    if (escalate) {
      return {
        handled: true,
        reply: `${buildHonestMediaFallback(mediaType)} Un asesor puede revisarlo contigo.`,
        statePatch: buildStandardHandoffStatePatch(summary, {
          last_change_type: 'cuarzo_media_handoff',
        }),
        responseSource: 'cuarzo_media_handoff',
        pending_version: 'Amatista',
      };
    }

    return {
      handled: true,
      reply: buildHonestMediaFallback(mediaType),
      statePatch: {
        awaiting_field: null,
        last_change_type: 'cuarzo_media_fallback',
      },
      responseSource: 'cuarzo_media_fallback',
      pending_version: 'Amatista',
    };
  }

  // Cambio radical ambiguo (no clarifica intención nueva)
  if (
    sig.radical_change === true &&
    !sig.lead_flow &&
    !normalizeText(text).includes('vender') &&
    !normalizeText(text).includes('busco') &&
    !normalizeText(text).includes('rent')
  ) {
    const summary = buildOperationalHandoffSummary(merged, {
      reason: 'ambiguous_intent',
      userSnippet: cleanSpaces(String(text || '')),
      pendingVersion: PENDING_VERSION.pre_engine,
    });
    return {
      handled: true,
      reply: buildAmbiguousIntentFallback(),
      statePatch: buildStandardHandoffStatePatch(summary, {
        last_change_type: 'cuarzo_ambiguous_handoff',
      }),
      responseSource: 'cuarzo_ambiguous_handoff',
      pending_version: 'Topacio',
    };
  }

  // Ubicación marcada como inválida / no parseable
  if (sig.location_unparseable === true && merged.awaiting_field === 'location_text') {
    return {
      handled: true,
      reply: buildLocationUnparseableFallback(),
      statePatch: { last_change_type: 'cuarzo_location_fallback' },
      responseSource: 'cuarzo_location_fallback',
      pending_version: null,
    };
  }

  return { handled: false };
}

module.exports = {
  PENDING_VERSION,
  resolveCuarzoOutOfScopeTurn,
  buildHonestMediaFallback,
  buildLegalFallback,
};
