'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessageSignals } = require('../conversation/parsers');
const {
  processConversationTurnV2,
  shouldUseConversationEngineV2,
  buildSafeEngineFallback,
} = require('../conversation/conversationEngineV2');

function baseInput(overrides = {}) {
  return {
    text: '',
    normalizedText: '',
    conversationId: 'test-conv-1',
    phone: '+5218115551234',
    previousAiState: {},
    conversationRow: { id: 'test-conv-1' },
    contact: null,
    lead: null,
    recentMessages: [],
    inboundContext: {},
    unifiedContext: null,
    referralContext: null,
    campaignContext: null,
    media: {},
    propertiesContext: { matchedProperties: [] },
    parsedSignals: {},
    routeEvaluatorDecision: null,
    waProfileDisplayName: null,
    changeType: 'minor_update',
    logger: console,
    getPropertyByCode: async () => null,
    searchPropertiesWithFallbacks: async () => ({
      properties: [],
      attemptUsed: 'none',
      resultQuality: 'none',
      topMatchScore: 0,
      rawResultCount: 0,
    }),
    ...overrides,
  };
}

describe('conversationEngineV2 e2e', () => {
  beforeEach(() => {
    process.env.PERSEO_ENGINE_V2 = 'true';
    process.env.PERSEO_CONVERSATION_ORCHESTRATOR_MODE = 'fallback_only';
  });

  afterEach(() => {
    delete process.env.PERSEO_ENGINE_V2;
    delete process.env.PERSEO_CONVERSATION_ORCHESTRATOR_MODE;
  });

  it('A — compra básica: zona primero, nombre, presupuesto (sin plantilla demand/playbook)', async () => {
    const t1 = 'Hola, busco casa en Cumbres';
    const sig1 = parseMessageSignals(t1, {}, {});
    const out1 = await processConversationTurnV2(
      baseInput({
        text: t1,
        parsedSignals: sig1,
        previousAiState: {},
      }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Hola, claro. Te puedo ayudar con casa en Cumbres. Para registrarte bien, ¿me compartes tu nombre?',
        }),
      }
    );
    assert.match(String(out1.reply), /Cumbres/i);
    assert.match(String(out1.reply), /nombre/i);
    assert.doesNotMatch(String(out1.reply), /^¿Cuál es tu presupuesto/i);
    assert.doesNotMatch(String(out1.reply), /publicaci[oó]n|liga|disponibilidad/i);
    assert.equal(out1.orchestratorDecision?.reply_strategy?.goal, 'capture_name');
    assert.equal(out1.nextAiState.lead_flow, 'demand');

    const prev2 = { ...out1.nextAiState };
    const t2 = 'Jorge';
    const sig2 = parseMessageSignals(t2, prev2, {});
    const out2 = await processConversationTurnV2(
      baseInput({
        text: t2,
        parsedSignals: sig2,
        previousAiState: prev2,
      }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Gracias, Jorge. ¿Qué presupuesto aproximado tienes para la casa en Cumbres?',
        }),
      }
    );
    assert.match(String(out2.reply), /Jorge/i);
    assert.match(String(out2.reply), /presupuesto/i);
    assert.equal(out2.nextAiState.full_name, 'Jorge');

    const prev3 = { ...out2.nextAiState };
    const t3 = '8 millones';
    const sig3 = parseMessageSignals(t3, prev3, {});
    const out3 = await processConversationTurnV2(
      baseInput({
        text: t3,
        parsedSignals: sig3,
        previousAiState: prev3,
      }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Perfecto, Jorge. Con ese presupuesto revisamos opciones reales en Cumbres.',
        }),
      }
    );
    assert.equal(out3.nextAiState.budget_max, 8000000);
    assert.equal(out3.nextAiState.budget_currency, 'MXN');
    assert.match(String(out3.nextAiState.location_text || prev3.location_text || ''), /Cumbres/i);
  });

  it('B — propiedad: código en estado; disponibilidad no inventada en fallback seguro', async () => {
    const prev = {
      lead_flow: 'demand',
      operation_type: 'sale',
      full_name: 'Ana',
      property_code: 'LUX-A0470',
      direct_property_reference: true,
      property_specific_intent: true,
      location_text: 'Cumbres',
    };
    const t = '¿Sigue disponible?';
    const sig = parseMessageSignals(t, prev, {});
    const out = await processConversationTurnV2(
      baseInput({
        text: t,
        parsedSignals: sig,
        previousAiState: prev,
        getPropertyByCode: async (code) =>
          code
            ? {
                id: 'p1',
                listing_id: 'A0470',
                price: 12300000,
                currency: 'MXN',
              }
            : null,
      }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Para disponibilidad al día de hoy, un asesor confirma en sistema; yo no cierro disponibilidad sin ese dato.',
        }),
      }
    );
    assert.equal(out.nextAiState.property_code || prev.property_code, 'LUX-A0470');
    assert.match(String(out.reply), /disponibilidad|confirm|asesor/i);
    assert.doesNotMatch(String(out.reply), /s[ií] est[aá] disponible/i);
  });

  it('C — venta: owner + zona + nombre', async () => {
    const steps = [
      { text: 'Quiero vender mi casa', key: 's1' },
      { text: 'Mía', key: 's2' },
      { text: 'Está en Cumbres', key: 's3' },
      { text: 'Me llamo Mariana', key: 's4' },
    ];
    let state = {};
    for (const step of steps) {
      const sig = parseMessageSignals(step.text, state, {});
      state = (
        await processConversationTurnV2(
          baseInput({
            text: step.text,
            parsedSignals: sig,
            previousAiState: state,
          }),
          {
            generateAdvisorReplyFn: async ({ user_message }) => ({
              text: `OK:${user_message}`,
            }),
          }
        )
      ).nextAiState;
    }
    assert.equal(state.lead_flow, 'offer');
    assert.equal(state.owner_relation, 'owner');
    assert.match(String(state.location_text || ''), /Cumbres/i);
    assert.equal(state.full_name, 'Mariana');
  });

  it('D — venta + compra mixta conserva oferta', async () => {
    let state = {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Cumbres',
      full_name: 'Luis',
    };
    const t = 'también quiero comprar una';
    const sig = parseMessageSignals(t, state, {});
    const out = await processConversationTurnV2(
      baseInput({
        text: t,
        parsedSignals: sig,
        previousAiState: state,
      }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Entendido: seguimos con tu venta en Cumbres y abrimos búsqueda de compra en paralelo.',
        }),
      }
    );
    assert.equal(out.nextAiState.lead_flow, 'offer');
    assert.match(String(out.reply), /venta/i);
    assert.match(String(out.reply), /compr/i);
  });

  it('E — queja: fallback seguro reconoce tono humano', async () => {
    const t = 'Ya dejé mis datos y nadie me ha contactado';
    const prev = { lead_flow: 'demand', full_name: 'Pedro' };
    const sig = parseMessageSignals(t, prev, {});
    const out = await processConversationTurnV2(
      baseInput({ text: t, parsedSignals: sig, previousAiState: prev }),
      {
        generateAdvisorReplyFn: async () => ({
          text: 'Lamento la demora; lo escalamos con un asesor humano para que te contacten.',
        }),
      }
    );
    assert.match(String(out.reply), /lamento|asesor|humano|contact/i);
  });

  it('F — fallo advisor: fallback seguro sin boilerplate publicación/liga', async () => {
    const t = 'Hola, busco casa en Cumbres';
    const sig = parseMessageSignals(t, {}, {});
    const out = await processConversationTurnV2(
      baseInput({ text: t, parsedSignals: sig, previousAiState: {} }),
      {
        generateAdvisorReplyFn: async () => {
          throw new Error('simulated_advisor_failure');
        },
      }
    );
    assert.match(String(out.responseSource), /fallback/i);
    const body = String(out.reply);
    assert.ok(body.length > 10);
    assert.doesNotMatch(body, /publicaci[oó]n, liga y disponibilidad/i);
    assert.doesNotMatch(body, /Con gusto reviso ese punto contigo/i);
  });

  it('shouldUseConversationEngineV2 honra flag y excluye QA', () => {
    delete process.env.PERSEO_ENGINE_V2;
    assert.equal(
      shouldUseConversationEngineV2({
        text: 'Hola',
        parsedSignals: { lead_flow: 'demand' },
        inboundContext: {},
      }),
      false
    );
    process.env.PERSEO_ENGINE_V2 = 'true';
    assert.equal(
      shouldUseConversationEngineV2({
        text: '!reset',
        parsedSignals: {},
        inboundContext: {},
      }),
      false
    );
  });

  it('buildSafeEngineFallback demanda inicial sin nombre', () => {
    const fb = buildSafeEngineFallback({
      text: 'busco en Cumbres',
      parsedSignals: { lead_flow: 'demand', location_text: 'Cumbres' },
      previousAiState: {},
    });
    assert.match(fb, /Cumbres/i);
    assert.match(fb, /nombre/i);
  });
});
