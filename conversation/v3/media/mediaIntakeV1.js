'use strict';

const { cleanSpaces, normalizeMultilineText } = require('../../../utils/text');
const { isMediaIntakeV1Enabled } = require('../../../config/perseoM3Flags');
const {
  composeAudioNoTranscriptFallback,
  composeAudioLowConfidenceFallback,
  composeImageIllegibleFallback,
} = require('./mediaFallbackComposer');

const LOW_CONFIDENCE_THRESHOLD = 0.55;

function normalizeHints(hints) {
  if (!Array.isArray(hints)) return [];
  return hints
    .map((h) => ({
      hint: cleanSpaces(h?.hint || h?.type || h?.label || ''),
      confidence: Number(h?.confidence ?? h?.score ?? 0.5),
    }))
    .filter((h) => h.hint);
}

/**
 * @param {{ text?: string, media?: object|null, state?: object }} input
 */
function runMediaIntakeV1(input) {
  const text = normalizeMultilineText(input.text || '');
  const media = input.media && typeof input.media === 'object' ? input.media : null;

  if (!media || !media.kind) {
    return {
      logical_turn: { text, source: 'text', confidence: 1 },
      media_intake: { mode: 'text_only', skipped: true },
    };
  }

  if (media.kind === 'audio') {
    const transcript = cleanSpaces(media.transcript || '');
    const confidence = Number(media.confidence ?? (transcript ? 0.9 : 0));

    if (media.no_transcript === true || !transcript) {
      return {
        logical_turn: { text: '', source: 'audio_no_transcript', confidence: 0 },
        media_intake: {
          mode: 'audio_no_transcript',
          kind: 'audio',
          transcript: null,
          confidence: null,
        },
        shortCircuitReply: composeAudioNoTranscriptFallback(),
      };
    }

    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      return {
        logical_turn: {
          text: transcript,
          source: 'audio_transcript_low_confidence',
          confidence,
        },
        media_intake: {
          mode: 'audio_low_confidence',
          kind: 'audio',
          transcript,
          confidence,
        },
        shortCircuitReply: composeAudioLowConfidenceFallback(transcript),
      };
    }

    return {
      logical_turn: { text: transcript, source: 'audio_transcript', confidence },
      media_intake: {
        mode: 'transcript_used',
        kind: 'audio',
        transcript,
        confidence,
      },
    };
  }

  if (media.kind === 'document' || media.kind === 'pdf') {
    const docText = cleanSpaces(media.extracted_text || '');
    const confidence = Number(media.confidence ?? (docText ? 0.85 : 0));

    if (!docText) {
      return {
        logical_turn: { text: text || '', source: 'document_empty', confidence: 0 },
        media_intake: {
          mode: 'document_no_text',
          kind: media.kind,
          extracted_text: null,
          confidence: null,
        },
        shortCircuitReply: composeImageIllegibleFallback(),
      };
    }

    const merged = text ? `${text}\n${docText}` : docText;
    return {
      logical_turn: {
        text: normalizeMultilineText(merged),
        source: 'document_text',
        confidence,
      },
      media_intake: {
        mode: 'document_text_used',
        kind: media.kind,
        extracted_text: docText,
        confidence,
        document_non_authoritative: true,
      },
    };
  }

  if (media.kind === 'image' || media.kind === 'screenshot') {
    const hints = normalizeHints(media.hints);
    const caption = cleanSpaces(media.caption || '');
    const userText = text || caption;

    if (media.illegible === true) {
      return {
        logical_turn: { text: userText, source: 'image_illegible', confidence: 0 },
        media_intake: {
          mode: 'image_illegible',
          kind: 'image',
          hints: [],
          hints_are_non_authoritative: true,
        },
        shortCircuitReply: composeImageIllegibleFallback(),
      };
    }

    let logicalText = userText;
    if (!logicalText && hints.length) {
      logicalText = cleanSpaces(
        `El usuario envió una imagen (referencia visual: ${hints.map((h) => h.hint).join(', ')}).`,
      );
    } else if (!logicalText) {
      logicalText = 'El usuario envió una imagen sin descripción.';
    }

    return {
      logical_turn: {
        text: logicalText,
        source: userText ? 'image_with_text' : 'image_hints_only',
        confidence: 1,
      },
      media_intake: {
        mode: userText ? 'image_with_text' : 'image_hints_only',
        kind: 'image',
        hints,
        hints_are_non_authoritative: true,
        caption: caption || null,
      },
    };
  }

  return {
    logical_turn: { text, source: 'text', confidence: 1 },
    media_intake: { mode: 'unsupported_media_kind', kind: media.kind },
  };
}

/**
 * @param {object} input
 */
function maybeRunMediaIntakeV1(input) {
  if (!isMediaIntakeV1Enabled()) {
    return {
      enabled: false,
      logical_turn: {
        text: normalizeMultilineText(input.text || ''),
        source: 'text',
        confidence: 1,
      },
      media_intake: null,
    };
  }
  const result = runMediaIntakeV1(input);
  return { enabled: true, ...result };
}

module.exports = {
  runMediaIntakeV1,
  maybeRunMediaIntakeV1,
  LOW_CONFIDENCE_THRESHOLD,
};
