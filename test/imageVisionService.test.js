const test = require('node:test');
const assert = require('node:assert/strict');

function loadImageVisionService(envOverrides = {}) {
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    IMAGE_VISION_ENABLED: process.env.IMAGE_VISION_ENABLED,
    IMAGE_VISION_MODEL: process.env.IMAGE_VISION_MODEL,
    IMAGE_VISION_TIMEOUT_MS: process.env.IMAGE_VISION_TIMEOUT_MS,
    IMAGE_VISION_MAX_BYTES: process.env.IMAGE_VISION_MAX_BYTES,
    MEDIA_DOWNLOAD_MAX_BYTES: process.env.MEDIA_DOWNLOAD_MAX_BYTES,
  };

  Object.assign(process.env, envOverrides);

  delete require.cache[require.resolve('../config/env')];
  delete require.cache[require.resolve('../services/imageVisionService')];

  const loaded = require('../services/imageVisionService');

  return {
    ...loaded,
    restore() {
      process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
      process.env.IMAGE_VISION_ENABLED = previous.IMAGE_VISION_ENABLED;
      process.env.IMAGE_VISION_MODEL = previous.IMAGE_VISION_MODEL;
      process.env.IMAGE_VISION_TIMEOUT_MS = previous.IMAGE_VISION_TIMEOUT_MS;
      process.env.IMAGE_VISION_MAX_BYTES = previous.IMAGE_VISION_MAX_BYTES;
      process.env.MEDIA_DOWNLOAD_MAX_BYTES = previous.MEDIA_DOWNLOAD_MAX_BYTES;

      delete require.cache[require.resolve('../config/env')];
      delete require.cache[require.resolve('../services/imageVisionService')];
    },
  };
}

test('analyzeImage missing_file returns controlled result', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: null,
    mimeType: 'image/jpeg',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'missing_file');
  assert.equal(result.errorCode, 'image_file_buffer_missing');
  service.restore();
});

test('analyzeImage unsupported_mime for non image format', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake'),
    mimeType: 'application/pdf',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unsupported_mime');
  service.restore();
});

test('analyzeImage returns skipped when config disabled', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'false',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake'),
    mimeType: 'image/jpeg',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'skipped');
  assert.equal(result.errorCode, 'image_vision_disabled');
  service.restore();
});

test('analyzeImage handles provider error transparently', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake-image'),
    mimeType: 'image/png',
    visionProvider: async () => {
      throw Object.assign(new Error('provider timeout'), { code: 'provider_timeout' });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'provider_timeout');
  service.restore();
});

test('analyzeImage parses valid JSON payload', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake-image'),
    mimeType: 'image/jpeg',
    visionProvider: async () => ({
      output_text: JSON.stringify({
        summary: 'Fachada de casa con porton y cochera al frente.',
        propertySignals: {
          appearsToBeProperty: true,
          probablePropertyType: 'casa',
          visibleAreaType: 'fachada',
          apparentCondition: 'buena',
          visibleFeatures: ['porton', 'cochera'],
          visibleIssues: [],
          confidence: 0.82,
        },
        suggestedFollowUp: '¿Buscas venderla o rentarla y en que colonia esta?',
        caution: 'Analisis visual referencial.',
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'analyzed');
  assert.equal(result.propertySignals.probablePropertyType, 'casa');
  assert.equal(result.propertySignals.visibleAreaType, 'fachada');
  assert.equal(result.propertySignals.apparentCondition, 'buena');
  assert.equal(result.propertySignals.confidence, 0.82);
  service.restore();
});

test('analyzeImage malformed response fails safely', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake-image'),
    mimeType: 'image/webp',
    visionProvider: async () => ({ output_text: 'respuesta sin json valido' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.errorCode, /invalid_json|json_parse_failed/i);
  service.restore();
});

test('analyzeImage facade-like image returns structured property signals', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake-image'),
    mimeType: 'image/jpeg',
    visionProvider: async () => ({
      output_text: JSON.stringify({
        summary: 'Se observa fachada de casa con cochera y acceso peatonal.',
        propertySignals: {
          appearsToBeProperty: true,
          probablePropertyType: 'casa',
          visibleAreaType: 'fachada',
          apparentCondition: 'regular',
          visibleFeatures: ['cochera', 'fachada'],
          visibleIssues: ['pintura con desgaste'],
          confidence: 0.74,
        },
        suggestedFollowUp: '¿La quieres vender o rentar?',
        caution: 'Referencial por foto unica.',
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.propertySignals.appearsToBeProperty, true);
  assert.equal(result.propertySignals.visibleAreaType, 'fachada');
  assert.match(result.suggestedFollowUp, /vender|rentar/i);
  service.restore();
});

test('analyzeImage blurry image returns no_concluyente style output', async () => {
  const service = loadImageVisionService({
    OPENAI_API_KEY: 'test-key',
    IMAGE_VISION_ENABLED: 'true',
  });

  const result = await service.analyzeImage({
    fileBuffer: Buffer.from('fake-image'),
    mimeType: 'image/png',
    visionProvider: async () => ({
      output_text: JSON.stringify({
        summary: 'Imagen borrosa, sin detalles suficientes para clasificar propiedad.',
        propertySignals: {
          appearsToBeProperty: null,
          probablePropertyType: 'unknown',
          visibleAreaType: 'unknown',
          apparentCondition: 'no_concluyente',
          visibleFeatures: [],
          visibleIssues: ['falta de nitidez'],
          confidence: 0.22,
        },
        suggestedFollowUp: '¿Buscas vender, rentar o comprar?',
        caution: 'No concluyente por calidad de imagen.',
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.propertySignals.apparentCondition, 'no_concluyente');
  assert.equal(result.propertySignals.visibleAreaType, 'unknown');
  assert.equal(result.propertySignals.confidence, 0.22);
  service.restore();
});
