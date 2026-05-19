'use strict';

const { cleanSpaces } = require('../utils/text');

/**
 * Normaliza un turno de escenario ARGOS (string o objeto media).
 * @param {string|object} raw
 * @returns {{ text: string, media: object|null }}
 */
function normalizeScenarioTurn(raw) {
  if (typeof raw === 'string') {
    return { text: raw, media: null };
  }
  if (!raw || typeof raw !== 'object') {
    return { text: '', media: null };
  }

  const type = raw.type || raw.media;
  if (type === 'audio') {
    const media = {
      kind: 'audio',
      transcript: cleanSpaces(raw.transcript || raw.simulate_transcript || ''),
      confidence:
        raw.confidence != null
          ? Number(raw.confidence)
          : raw.simulate_confidence != null
            ? Number(raw.simulate_confidence)
            : undefined,
      no_transcript: raw.no_transcript === true,
    };
    if (raw.simulate_transcript) {
      media.simulate_transcript = cleanSpaces(raw.simulate_transcript);
      media.provider = 'argos_deterministic';
    }
    if (raw.simulate_confidence != null) {
      media.simulate_confidence = Number(raw.simulate_confidence);
    }
    return { text: cleanSpaces(raw.text || raw.caption || ''), media };
  }

  if (type === 'image' || type === 'screenshot') {
    const media = {
      kind: type === 'screenshot' ? 'screenshot' : 'image',
      hints: Array.isArray(raw.hints) ? raw.hints : [],
      caption: cleanSpaces(raw.caption || ''),
      illegible: raw.illegible === true,
    };
    if (Array.isArray(raw.simulate_hints)) {
      media.simulate_hints = raw.simulate_hints;
      media.provider = 'argos_deterministic';
    }
    return { text: cleanSpaces(raw.text || raw.caption || ''), media };
  }

  if (type === 'document' || type === 'pdf') {
    return {
      text: cleanSpaces(raw.text || raw.caption || ''),
      media: {
        kind: type,
        extracted_text: cleanSpaces(raw.extracted_text || raw.simulate_text || ''),
        confidence: raw.confidence != null ? Number(raw.confidence) : undefined,
        provider: raw.simulate_text ? 'argos_deterministic' : undefined,
      },
    };
  }

  return { text: cleanSpaces(raw.text || JSON.stringify(raw)), media: null };
}

module.exports = { normalizeScenarioTurn };
