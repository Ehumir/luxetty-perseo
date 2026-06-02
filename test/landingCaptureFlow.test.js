'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
});

const { processV3Turn, clearV3Session } = require('../conversation/v3');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const {
  matchesLandingCaptureInbound,
  LANDING_CAPTURE_FALLBACK_REPLY,
} = require('../conversation/v3/interpreter/landingCaptureFlow');

const OFFICIAL_MSG =
  'Hola Luxetty. Me interesa una prevaluación. Tengo una propiedad en Cumbres o zona poniente y quiero recibir una prevaluación comercial inicial para conocer mi mejor opción de venta o renta.';

const WELCOME_SNIPPET = 'asistente IA de Luxetty';

describe('Sprint 2 — landing capture flow', () => {
  it('caso 1: mensaje oficial activa flujo sin asumir venta', () => {
    const cid = 's2-official';
    clearV3Session(cid);
    const r = processV3Turn({ conversationId: cid, phone: '5218111111111', text: OFFICIAL_MSG });
    assert.equal(r.state.landingCaptureFlow, true);
    assert.notEqual(r.state.operationType, 'sale');
    assert.match(String(r.reply), new RegExp(WELCOME_SNIPPET, 'i'));
    assert.match(String(r.reply), /nombre/i);
    const legacy = mapV3StateToLegacyAiState(r.state);
    assert.equal(legacy.landing_capture_flow, true);
    assert.equal(legacy.operation_type_pending, true);
    assert.equal(legacy.lead_type, 'supply');
  });

  it('caso 2: mensaje similar activa captación', () => {
    const cid = 's2-similar';
    clearV3Session(cid);
    const t = 'Hola, quiero una prevaluación de mi casa en Cumbres.';
    assert.equal(matchesLandingCaptureInbound(t), true, 'detector debe reconocer mensaje similar');
    const r = processV3Turn({ conversationId: cid, phone: '5218111111112', text: t });
    assert.equal(r.state.landingCaptureFlow, true);
    assert.match(String(r.reply), new RegExp(WELCOME_SNIPPET, 'i'));
  });

  it('caso 3: zona no listada continúa flujo', () => {
    const cid = 's2-zone';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111113', text: OFFICIAL_MSG });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111113',
      text: 'Soy Ana. Está en Cerradas de Cumbres.',
    });
    assert.match(String(r.reply), /Ana/i);
    assert.match(String(r.reply), /Cerradas de Cumbres/i);
    assert.match(String(r.reply), /casa|departamento|terreno|local/i);
    assert.notEqual(r.state.operationType, 'sale');
  });

  it('caso 4: usuario explorando — respuesta consultiva', () => {
    const cid = 's2-explore';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111114', text: OFFICIAL_MSG });
    processV3Turn({ conversationId: cid, phone: '5218111111114', text: 'Soy Luis. Está en Cumbres.' });
    processV3Turn({ conversationId: cid, phone: '5218111111114', text: 'Es casa.' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111114',
      text: 'Aún estoy explorando.',
    });
    assert.match(String(r.reply), /explor/i);
    assert.match(String(r.reply), /rango|revisemos/i);
    assert.notEqual(r.state.operationType, 'sale');
  });

  it('caso 5: pide humano — fallback y handoff', () => {
    const cid = 's2-human';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111115', text: OFFICIAL_MSG });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111115',
      text: 'Prefiero hablar con una persona.',
    });
    assert.match(
      String(r.reply),
      /asesor humano|canalizar tu caso con un asesor/i,
    );
  });

  it('caso 6: pregunta costo prevaluación', () => {
    const cid = 's2-cost';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111116', text: OFFICIAL_MSG });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111116',
      text: '¿Cuánto cuesta la prevaluación?',
    });
    assert.match(String(r.reply), /no tiene costo/i);
  });

  it('caso 7: pregunta si es avalúo', () => {
    const cid = 's2-appraisal';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111117', text: OFFICIAL_MSG });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111117',
      text: '¿Esto es un avalúo?',
    });
    assert.match(String(r.reply), /no un aval[uú]o/i);
    assert.match(String(r.reply), /prevaluaci[oó]n comercial inicial/i);
  });

  it('caso 8: ambigüedad en etapa — canaliza a humano', () => {
    const cid = 's2-fallback';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111118', text: OFFICIAL_MSG });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111118',
      text: '%%% ???',
    });
    assert.match(
      String(r.reply),
      /asesor humano|canalizar tu caso con un asesor/i,
    );
  });

  it('venta explícita tras explorar clasifica sale', () => {
    const cid = 's2-sell';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218111111119', text: OFFICIAL_MSG });
    processV3Turn({ conversationId: cid, phone: '5218111111119', text: 'Soy Carlos. Está en Cumbres Elite.' });
    processV3Turn({ conversationId: cid, phone: '5218111111119', text: 'Es casa.' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218111111119',
      text: 'Quiero venderla.',
    });
    assert.equal(r.state.operationType, 'sale');
    assert.match(String(r.reply), /precio aproximado|rango/i);
  });
});
