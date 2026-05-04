const { openai } = require('./openaiService');
const { OPENAI_MODEL } = require('../config/env');
const { cleanSpaces } = require('../utils/text');

function toDataUrl(buffer, mimeType = 'image/jpeg') {
  const base64 = Buffer.from(buffer || []).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function defaultResponse(overrides = {}) {
  return {
    ok: false,
    kind: 'unknown',
    confidence: 0,
    summary: null,
    propertySignals: {
      appearsProperty: false,
      likelyPropertyType: null,
      condition: null,
      indoorOutdoor: null,
    },
    documentSignals: {
      appearsDocument: false,
      likelyDocumentType: null,
      potentiallyLegal: false,
    },
    riskFlags: [],
    disclaimer:
      'Analisis visual preliminar automatico. No sustituye una revision legal, comercial ni tecnica.',
    ...overrides,
  };
}

function clampConfidence(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

async function analyzePropertyImage({ buffer, mimeType, caption, conversationState } = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    return defaultResponse({
      ok: false,
      error: 'image_buffer_missing',
      summary: 'No se pudo analizar la imagen porque no fue posible leer el archivo.',
    });
  }

  const normalizedMimeType = cleanSpaces(mimeType || '') || 'image/jpeg';
  const inputCaption = cleanSpaces(caption || '') || null;
  const stateHints = {
    lead_flow: conversationState?.lead_flow || null,
    operation_type: conversationState?.operation_type || null,
    location_text: conversationState?.location_text || null,
  };

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Eres un analizador visual para CRM inmobiliario. Debes responder SOLO JSON valido sin markdown ni texto extra.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analiza la imagen para contexto inmobiliario. Usa esta guia:\n- caption: ${inputCaption || 'sin caption'}\n- state_hints: ${JSON.stringify(stateHints)}\nDevuelve SOLO JSON con llaves: kind, confidence, summary, propertySignals, documentSignals, riskFlags.\nkind debe ser uno de: property_photo, document_image, unknown.\nconfidence entre 0 y 1.\nsummary maximo 240 caracteres en espanol neutro.\nNo inventes direccion, precios o datos legales concluyentes.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: toDataUrl(buffer, normalizedMimeType),
              },
            },
          ],
        },
      ],
    });

    const rawContent = completion?.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(rawContent);

    if (!parsed || typeof parsed !== 'object') {
      return defaultResponse({
        ok: false,
        error: 'invalid_model_json',
        summary: 'Se recibio una respuesta no estructurada del analizador visual.',
        rawModelOutput: rawContent || null,
      });
    }

    return defaultResponse({
      ok: true,
      kind: ['property_photo', 'document_image', 'unknown'].includes(parsed.kind)
        ? parsed.kind
        : 'unknown',
      confidence: clampConfidence(parsed.confidence),
      summary: cleanSpaces(parsed.summary || '') || null,
      propertySignals:
        parsed.propertySignals && typeof parsed.propertySignals === 'object'
          ? {
              appearsProperty: !!parsed.propertySignals.appearsProperty,
              likelyPropertyType: parsed.propertySignals.likelyPropertyType || null,
              condition: parsed.propertySignals.condition || null,
              indoorOutdoor: parsed.propertySignals.indoorOutdoor || null,
            }
          : undefined,
      documentSignals:
        parsed.documentSignals && typeof parsed.documentSignals === 'object'
          ? {
              appearsDocument: !!parsed.documentSignals.appearsDocument,
              likelyDocumentType: parsed.documentSignals.likelyDocumentType || null,
              potentiallyLegal: !!parsed.documentSignals.potentiallyLegal,
            }
          : undefined,
      riskFlags: Array.isArray(parsed.riskFlags)
        ? parsed.riskFlags.map((flag) => cleanSpaces(String(flag || ''))).filter(Boolean)
        : [],
      rawModelOutput: rawContent || null,
    });
  } catch (err) {
    return defaultResponse({
      ok: false,
      error: err?.code || err?.message || 'vision_analysis_failed',
      summary: 'No pude completar el analisis automatico de la imagen en este momento.',
    });
  }
}

module.exports = {
  analyzePropertyImage,
};
