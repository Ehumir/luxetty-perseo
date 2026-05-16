'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
});

const { FORCED_HANDOFF_REASONS } = require('../conversation/v3/types/forcedHandoffReasons');
const {
  composeForcedHandoffFallback,
  assertForcedHandoffQuality,
} = require('../conversation/v3/composer/forcedHandoffComposer');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const {
  processV3Turn,
  clearV3Session,
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  ADVISOR_CONTACT_CONSENT,
} = require('../conversation/v3');
const { applyPropertyReplyAntiLoop } = require('../conversation/v3/composer/slotTemplates');
const { composeObjectionReply } = require('../conversation/v3/composer/objectionComposer');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');

const REQUIRED_COPY = /\b(asesor|asesora)\b/i;
const CANALIZE = /\b(canalizar|canalizaci[oó]n)\b/i;
const CONTACT = /\b(contactar[aá]|contactar[aá]n|escribir[aá]|seguimiento|whatsapp)\b/i;

function assertForcedCopy(text, label) {
  assert.match(String(text), REQUIRED_COPY, label);
  assert.match(String(text), CANALIZE, label);
  assert.match(String(text), CONTACT, label);
}

describe('F4 forced fallback variants', () => {
  for (const reason of Object.values(FORCED_HANDOFF_REASONS)) {
    it(`reason ${reason} produces mandatory copy with variant lead`, () => {
      const state = createInitialConversationState({ conversationId: 'f4-reason', phone: '521' });
      state.collectedFields = { fullName: 'Laura' };
      const out = composeForcedHandoffFallback(state, reason, { userText: '???' });
      assert.equal(assertForcedHandoffQuality(out.responseText), true);
      assertForcedCopy(out.responseText, reason);
      assert.ok(out.responseText.length > 60, reason);
    });
  }

  it('user_requests_human + ¿eres bot? incluye transparencia IA', () => {
    const state = createInitialConversationState({ conversationId: 'f4-bot' });
    const out = composeForcedHandoffFallback(state, FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN, {
      userText: '¿Eres bot?',
    });
    assert.match(out.responseText, /asesor\s+IA\s+de\s+Luxetty/i);
    assert.match(out.responseText, /canalizar/i);
    assertForcedCopy(out.responseText, 'bot');
  });
});

describe('F4 objections', () => {
  it('comisión no promete porcentaje cerrado', () => {
    const out = composeObjectionReply('commission', createInitialConversationState({}));
    assert.match(out.responseText, /comisi[oó]n/i);
    assert.doesNotMatch(out.responseText, /\b\d+\s*%/);
    assert.match(out.responseText, /asesor/i);
  });

  it('exclusiva responde consultivo', () => {
    const out = composeObjectionReply('no_exclusivity', createInitialConversationState({}));
    assert.match(out.responseText, /exclusiva/i);
    assert.match(out.responseText, /asesor/i);
  });
});

describe('F4 integration processV3Turn', () => {
  it('¿eres bot? → transparencia + canalización', () => {
    const cid = 'f4-bot-int';
    clearV3Session(cid);
    const r = processV3Turn({ conversationId: cid, phone: '521', text: '¿Eres bot?' });
    assert.match(String(r.reply), /asesor\s+IA\s+de\s+Luxetty/i);
    assert.match(String(r.reply), /canalizar/i);
    assert.equal(r.state.conversationStage, CONVERSATION_STAGES.HANDOFF_PENDING);
  });

  it('no me estás entendiendo en HANDOFF_PENDING no reinicia menú', () => {
    const cid = 'f4-frust-pending';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: '¿Eres bot?' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'No me estás entendiendo' });
    assert.doesNotMatch(String(r.reply), /Buscas vender, poner en renta, comprar o rentar/i);
    assert.match(String(r.reply), /ya\s+tengo\s+anotad|canaliz/i);
  });

  it('gracias después de ACCEPTED cierra corto', () => {
    const cid = 'f4-thanks';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Busco casa en Cumbres, 6 millones' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Ana' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'casa' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Sí, que me contacte un asesor' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Gracias' });
    assert.match(String(r.reply), /gusto|anotado|asesor/i);
    assert.doesNotMatch(String(r.reply), /Prefiero no repetir el mismo cierre/i);
    assert.doesNotMatch(String(r.reply), /precio publicado, zona o enlace/i);
    assert.equal(r.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
  });

  it('Sí tras handoff no dispara anti-loop de propiedad', () => {
    const cid = 'f4-prop-si';
    clearV3Session(cid);
    processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Hola, me interesa la propiedad LUX-A0462',
    });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Quiero hablar con un asesor' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Sí' });
    assert.doesNotMatch(String(r.reply), /Prefiero no repetir el mismo cierre/i);
    assert.equal(r.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
  });

  it('compra abierta: un solo mensaje de handoff al completar presupuesto', () => {
    const cid = 'f4-buy-single';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Busco casa en Cumbres' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Luis' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: '6 millones' });
    assert.doesNotMatch(String(r.reply), /Prefiero no repetir/i);
    assert.match(String(r.reply), /asesor|presupuesto|6|millones|contact/i);
    assert.notEqual(r.forcedHandoffReason, 'intent_unknown');
  });

  it('legacy gate off con PERSEO_V3_ENABLED=false', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';
    try {
      assert.equal(evaluateV3PrimaryGate({ phone: '521' }).v3_primary_allowed, false);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prev;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});

describe('F4 anti-loop unit', () => {
  it('CRM_READY + handoff duplicado → ack corto', () => {
    const state = createInitialConversationState({});
    state.conversationStage = CONVERSATION_STAGES.CRM_READY;
    state.advisorContactConsent = ADVISOR_CONTACT_CONSENT.ACCEPTED;
    state.collectedFields = { fullName: 'Jorge' };
    state.lastAssistantReply =
      'Listo, Jorge. Ya dejé anotado que un asesor de Luxetty te contacte por aquí.';
    const dup =
      'Perfecto, Jorge. Si te parece, puedo pedirle a un asesor de Luxetty que te contacte.';
    const anti = applyPropertyReplyAntiLoop({
      state,
      replyText: dup,
      handoffOut: { action: 'CONTINUE_QUALIFICATION' },
    });
    assert.equal(anti.replaced, true);
    assert.match(anti.text, /anotado|gusto/i);
    assert.doesNotMatch(anti.text, /Prefiero no repetir/i);
  });
});
