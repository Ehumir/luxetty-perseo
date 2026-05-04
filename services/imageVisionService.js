const {
  OPENAI_API_KEY,
  MEDIA_DOWNLOAD_MAX_BYTES,
  IMAGE_VISION_ENABLED,
  IMAGE_VISION_MODEL,
  IMAGE_VISION_TIMEOUT_MS,
  IMAGE_VISION_MAX_BYTES,
} = require('../config/env');
const { openai } = require('./openaiService');
const { cleanSpaces } = require('../utils/text');

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const PROPERTY_TYPES = new Set([
  'casa',
  'departamento',
  'terreno',
  'local',
  'oficina',
  'bodega',
  'interior',
  'exterior',
  'unknown',
]);

const AREA_TYPES = new Set([
  'fachada',
  'sala',
  'comedor',
  'cocina',
  'recamara',
  'bano',
  'patio',
  'cochera',
  'terraza',
  'terreno',
  'amenidad',
  'documento',
  'unknown',
]);

const CONDITION_TYPES = new Set([
  'excelente',
  'buena',
  'regular',
  'requiere_mantenimiento',
  'obra_negra',
  'no_concluyente',
]);

const BASE_PROMPT = [
  'Analiza esta imagen como asistente inmobiliario en Mexico.',
  'Extrae unicamente informacion visual observable.',
  'No inventes ubicacion, precio, metros cuadrados, numero de recamaras, numero de banos ni estado legal.',
  'No hagas valuacion automatica ni recomendacion de inversion.',
  'No identifiques personas ni datos sensibles.',
  'Si algo no es claro, marca no_concluyente o unknown segun aplique.',
  'Responde JSON VALIDO sin markdown usando esta estructura exacta:',
  '{',
  '  "summary": "string|null",',
  '  "propertySignals": {',
  '    "appearsToBeProperty": true|false|null,',
  '    "probablePropertyType": "casa|departamento|terreno|local|oficina|bodega|interior|exterior|unknown|null",',
  '    "visibleAreaType": "fachada|sala|comedor|cocina|recamara|bano|patio|cochera|terraza|terreno|amenidad|documento|unknown|null",',
  '    "apparentCondition": "excelente|buena|regular|requiere_mantenimiento|obra_negra|no_concluyente|null",',
  '    "visibleFeatures": ["string"],',
  '    "visibleIssues": ["string"],',
  '    "confidence": 0..1|null',
  '  },',
  '  "suggestedFollowUp": "string|null",',
  '  "caution": "string|null"',
  '}',
  'Mantente conservador y comercialmente util para continuar la conversacion.',
].join('\n');

function getEmptyPropertySignals() {
  return {
    appearsToBeProperty: null,
    probablePropertyType: null,
    visibleAreaType: null,
    apparentCondition: null,
    visibleFeatures: [],
    visibleIssues: [],
    confidence: null,
  };
}

function baseResult(overrides = {}) {
  return {
    ok: false,
    provider: 'openai',
    model: null,
    status: 'failed',
    summary: null,
    propertySignals: getEmptyPropertySignals(),
    suggestedFollowUp: null,
    caution: null,
    errorCode: null,
    errorMessage: null,
    raw: null,
    ...overrides,
  };
}

function normalizeMimeType(mimeType = '') {
  return cleanSpaces(String(mimeType || '').toLowerCase());
}

function clampConfidence(value) {
  if (value == null) return null;
  const number = Number(value);
  if (Number.isNaN(number)) return null;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function normalizeEnum(value, allowedValues) {
  if (value == null) return null;
  const normalized = cleanSpaces(String(value || '').toLowerCase()) || null;
  if (!normalized) return null;
  return allowedValues.has(normalized) ? normalized : 'unknown';
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  const dedup = new Set();

  for (const value of values) {
    const parsed = cleanSpaces(String(value || ''));
    if (!parsed) continue;
    dedup.add(parsed.slice(0, 140));
  }

  return Array.from(dedup).slice(0, 10);
}

function extractResponseText(response = {}) {
  const primary = cleanSpaces(response?.output_text || '');
  if (primary) return primary;

  const outputs = Array.isArray(response?.output) ? response.output : [];
  for (const output of outputs) {
    const content = Array.isArray(output?.content) ? output.content : [];
    for (const item of content) {
      const value = cleanSpaces(item?.text || '');
      if (value) return value;
    }
  }

  return '';
}

function extractJsonString(rawText = '') {
  const text = cleanSpaces(String(rawText || ''));
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return cleanSpaces(fenced[1]);
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function sanitizeSummary(summary = '') {
  const parsed = cleanSpaces(summary || '');
  if (!parsed) return null;
  return parsed.slice(0, 320);
}

async function defaultVisionProvider({ model, imageDataUrl, prompt }) {
  return openai.responses.create({
    model,
    temperature: 0.1,
    max_output_tokens: 500,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    ],
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('image_vision_timeout');
      error.code = 'image_vision_timeout';
      reject(error);
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeVisionPayload(payload = {}) {
  const propertySignals = payload?.propertySignals || {};

  return {
    summary: sanitizeSummary(payload?.summary || null),
    propertySignals: {
      appearsToBeProperty:
        typeof propertySignals?.appearsToBeProperty === 'boolean'
          ? propertySignals.appearsToBeProperty
          : null,
      probablePropertyType: normalizeEnum(propertySignals?.probablePropertyType, PROPERTY_TYPES),
      visibleAreaType: normalizeEnum(propertySignals?.visibleAreaType, AREA_TYPES),
      apparentCondition: normalizeEnum(propertySignals?.apparentCondition, CONDITION_TYPES),
      visibleFeatures: normalizeStringArray(propertySignals?.visibleFeatures),
      visibleIssues: normalizeStringArray(propertySignals?.visibleIssues),
      confidence: clampConfidence(propertySignals?.confidence),
    },
    suggestedFollowUp: cleanSpaces(payload?.suggestedFollowUp || '') || null,
    caution: cleanSpaces(payload?.caution || '') || null,
  };
}

async function analyzeImage({
  fileBuffer,
  mimeType,
  filename,
  mediaId,
  conversationId,
  messageId,
  caption,
  provider = 'openai',
  model,
  visionProvider,
} = {}) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const selectedModel = cleanSpaces(model || IMAGE_VISION_MODEL || '') || 'gpt-4o-mini';
  const timeoutMs = Number(IMAGE_VISION_TIMEOUT_MS || 30000);
  const maxBytes = Math.min(
    Number(IMAGE_VISION_MAX_BYTES || MEDIA_DOWNLOAD_MAX_BYTES || 0) || MEDIA_DOWNLOAD_MAX_BYTES,
    Number(MEDIA_DOWNLOAD_MAX_BYTES || IMAGE_VISION_MAX_BYTES || 0) || IMAGE_VISION_MAX_BYTES
  );

  if (!IMAGE_VISION_ENABLED) {
    return baseResult({
      status: 'skipped',
      model: selectedModel,
      errorCode: 'image_vision_disabled',
      errorMessage: 'Image vision feature is disabled by configuration',
    });
  }

  if (!OPENAI_API_KEY) {
    return baseResult({
      status: 'config_missing',
      model: selectedModel,
      errorCode: 'openai_api_key_missing',
      errorMessage: 'OPENAI_API_KEY is required for image vision analysis',
    });
  }

  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.byteLength === 0) {
    return baseResult({
      status: 'missing_file',
      model: selectedModel,
      errorCode: 'image_file_buffer_missing',
      errorMessage: 'Image buffer is required for vision analysis',
    });
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return baseResult({
      status: 'unsupported_mime',
      model: selectedModel,
      errorCode: 'unsupported_image_mime_type',
      errorMessage: 'Image mime type is not enabled for Sprint 4C',
    });
  }

  if (maxBytes > 0 && fileBuffer.byteLength > maxBytes) {
    return baseResult({
      status: 'skipped',
      model: selectedModel,
      errorCode: 'image_too_large',
      errorMessage: `Image exceeds max bytes limit (${maxBytes})`,
    });
  }

  if (provider !== 'openai') {
    return baseResult({
      status: 'failed',
      model: selectedModel,
      errorCode: 'unsupported_image_vision_provider',
      errorMessage: `Provider not supported: ${provider}`,
    });
  }

  const imageDataUrl = `data:${normalizedMimeType};base64,${fileBuffer.toString('base64')}`;
  const prompt = [
    BASE_PROMPT,
    caption ? `Caption de usuario (si existe): ${caption}` : 'Caption de usuario: (vacio)',
    `Referencia tecnica: filename=${cleanSpaces(filename || '') || 'none'}`,
    `Trazabilidad: media_id=${cleanSpaces(mediaId || '') || 'none'} message_id=${cleanSpaces(messageId || '') || 'none'} conversation_id=${cleanSpaces(conversationId || '') || 'none'}`,
  ].join('\n');

  try {
    const providerFn = typeof visionProvider === 'function' ? visionProvider : defaultVisionProvider;

    const rawResponse = await withTimeout(
      providerFn({
        model: selectedModel,
        imageDataUrl,
        prompt,
        timeoutMs,
      }),
      timeoutMs
    );

    const textResponse = extractResponseText(rawResponse);
    const jsonString = extractJsonString(textResponse);

    if (!jsonString) {
      return baseResult({
        status: 'failed',
        model: selectedModel,
        errorCode: 'image_vision_invalid_json',
        errorMessage: 'Vision provider returned no parseable JSON',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (error) {
      return baseResult({
        status: 'failed',
        model: selectedModel,
        errorCode: 'image_vision_json_parse_failed',
        errorMessage: error?.message || 'Vision JSON parsing failed',
      });
    }

    const normalized = normalizeVisionPayload(parsed);

    return {
      ok: true,
      provider,
      model: selectedModel,
      status: 'analyzed',
      summary: normalized.summary,
      propertySignals: normalized.propertySignals,
      suggestedFollowUp:
        normalized.suggestedFollowUp ||
        'Para orientarte bien, necesito confirmar si buscas vender, rentar o comprar esta propiedad.',
      caution:
        normalized.caution ||
        'Por lo visible en una sola imagen, el analisis es referencial y requiere validacion comercial.',
      errorCode: null,
      errorMessage: null,
      raw: {
        provider_response_id: rawResponse?.id || null,
        usage: rawResponse?.usage || null,
      },
    };
  } catch (error) {
    return baseResult({
      status: 'failed',
      model: selectedModel,
      errorCode: error?.code || 'image_vision_failed',
      errorMessage: error?.message || 'Unknown image vision failure',
    });
  }
}

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  analyzeImage,
};
