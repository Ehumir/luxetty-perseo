'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdvisorResponseDraftContext,
  inferResponseGoal,
  classifyShortRealEstateFollowUp,
  analyzeMemoryCohesion,
  computeNameTimingHint,
  buildUnifiedForbiddenClaims,
} = require('../conversation/advisorDraftContext');
const {
  detectRealEstateConsultativeFollowUp,
  isCandidateTooSimilarToLastOutbound,
  generateAdvisorReplyForRealEstateTurn,
} = require('../conversation/realEstateAdvisorReply');

test('PR3 A — link tras ficha: goal alineado + memoria detecta tarjeta previa', () => {
  const prop = {
    id: 'p-1',
    listing_id: 'LUX-A0001',
    title: 'Casa demo',
    price: 7500000,
    currency_code: 'MXN',
    slug: 'casa-demo',
  };
  const recentDb = [
    { direction: 'inbound', message_text: '8 millones en Cumbres' },
    {
      direction: 'outbound',
      message_text:
        'Te comparto una opción en Cumbres https://luxetty.com/propiedad/casa-demo • LUX-A0001 — 7.5M MXN',
    },
    { direction: 'inbound', message_text: 'pásame el link porfa' },
  ];
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'pásame el link porfa',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 8000000,
      budget_currency: 'MXN',
      last_search_result_count: 1,
      last_shown_property_ids: ['p-1'],
    },
    suggested_properties: [prop],
    last_suggested_property: prop,
    recent_db_messages: recentDb,
  });
  assert.equal(draft.response_goal, 'link_or_publication');
  assert.equal(draft.memory_cohesion?.outbound_had_property_card, true);
  assert.equal(draft.metadata?.advisor_followup_type, 'listing_link_public');
});

test('PR3 A — inferResponseGoal y classifyShortRealEstateFollowUp coinciden en link', () => {
  const msg = '¿tienes publicación?';
  const ai = { lead_flow: 'demand' };
  const cls = classifyShortRealEstateFollowUp(msg, 'demand');
  assert.equal(cls?.response_goal, 'link_or_publication');
  assert.equal(inferResponseGoal(msg, ai, {}), 'link_or_publication');
  assert.equal(detectRealEstateConsultativeFollowUp(msg, 'demand')?.reason, 'listing_link_public');
});

test('PR3 B — follow-up largo: último inbound antes del actual', () => {
  const rows = [
    { direction: 'inbound', message_text: 'busco en Apodaca' },
    { direction: 'outbound', message_text: 'Perfecto, ¿presupuesto?' },
    { direction: 'inbound', message_text: '5 millones' },
    { direction: 'outbound', message_text: 'Te mando opciones…' },
    { direction: 'inbound', message_text: '¿y otra opción más barata?' },
  ];
  const mem = analyzeMemoryCohesion(rows, { lead_flow: 'demand', next_step: 'search' }, '¿y otra opción más barata?');
  assert.match(String(mem.last_inbound_before_current || ''), /5 millones|presupuesto/i);
  assert.equal(mem.last_intent_lead_flow, 'demand');
  assert.equal(mem.last_next_step, 'search');
});

test('PR3 C — anti-repeat: misma intención semántica (playbook genérico)', () => {
  const last =
    'Con esa información puedo orientarte mejor. ¿Prefieres ver opciones disponibles o que un asesor de Luxetty te contacte?';
  assert.equal(isCandidateTooSimilarToLastOutbound(last, last), true);
  assert.equal(
    isCandidateTooSimilarToLastOutbound(
      'Con esa información puedo orientarte mejor. Prefieres ver opciones o asesor Luxetty?',
      last
    ),
    true
  );
});

test('PR3 D — nombre: hint none con contacto válido; soft_close en visita', () => {
  const contact = { first_name: 'Ana', last_name: 'Ruiz' };
  const ai = { lead_flow: 'demand', awaiting_field: null };
  assert.equal(computeNameTimingHint(contact, ai, 'qualify_demand'), 'none');
  assert.equal(computeNameTimingHint({ first_name: 'Cliente' }, ai, 'visit_intent'), 'soft_close');
});

test('PR3 E — PDF sin análisis documental: prohibición explícita', () => {
  const claims = buildUnifiedForbiddenClaims({
    last_suggested_property: { listing_id: 'X', price: 1, slug: 's' },
    media_context: { document_analysis_available: false },
  });
  const joined = claims.join(' ').toLowerCase();
  assert.match(joined, /pdf|documento/);
  assert.ok(!/(pdf|documento).*(pdf|documento)/i.test(joined.replace(/[^a-záéíóúñü ]/gi, ' ')) || claims.length < 30);
});

test('PR3 F — forbidden_claims unificados: sin duplicados exactos por línea', () => {
  const propNoSlug = { listing_id: 'LUX-Z', price: null };
  const list = buildUnifiedForbiddenClaims({
    last_suggested_property: propNoSlug,
    media_context: {},
  });
  const norm = list.map((l) => l.trim().slice(0, 80));
  assert.equal(new Set(norm).size, norm.length);
  const blob = list.join(' ').toLowerCase();
  assert.match(blob, /disponibilidad|agendada|pdf|url/);
});

test('PR3 G — advisor: hechos sin short si hubo tarjeta; instrucciones PR3 en system', async () => {
  let captured = [];
  const fakeClient = {
    chat: {
      completions: {
        create: async (payload) => {
          captured = payload.messages;
          return { choices: [{ message: { content: 'Aquí está el enlace publicado. ¿Te sirve agendar visita?' } }] };
        },
      },
    },
  };
  const prop = {
    title: 'Casa',
    price: 1,
    currency_code: 'MXN',
    neighborhood: 'PH',
    slug: 'casa-x',
    listing_id: 'LUX-A0001',
  };
  const recentDb = [
    { direction: 'outbound', message_text: 'Opción en https://luxetty.com/propiedad/casa-x • LUX-A0001' },
  ];
  const out = await generateAdvisorReplyForRealEstateTurn(
    {
      user_message: 'pásame el link',
      recent_messages: [{ role: 'user', content: 'ok' }],
      recent_db_messages_for_card_check: recentDb,
      current_lead_flow: 'demand',
      synthetic_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'PH', budget_max: 5e6 },
      last_suggested_property: prop,
      suggested_properties: [prop],
      budget: 5000000,
      zone: 'PH',
      operation: 'sale',
      missing_name: false,
      follow_up_reason: 'listing_link_public',
    },
    { openaiClient: fakeClient, model: 'test-model' }
  );
  const sysBlock = captured.find((m) => m.role === 'system' && String(m.content).includes('HECHOS_CONFIRMADOS_JSON'));
  assert.ok(sysBlock, 'debe existir bloque system con hechos');
  assert.match(sysBlock.content, /PR3 polish|Máximo 2–3 frases/);
  assert.match(sysBlock.content, /NO vuelvas a pegar la ficha completa/);
  assert.match(sysBlock.content, /MEMORY_COHESION_JSON/);
  const hechos = sysBlock.content.split('HECHOS_CONFIRMADOS_JSON:')[1]?.split('\n\n')[0] || '';
  assert.match(hechos, /last_suggested_property/);
  assert.doesNotMatch(hechos, /"short"\s*:/);
  assert.equal(out.advisor_shortened_response, true);
  assert.equal(out.reused_memory_context, true);
});
