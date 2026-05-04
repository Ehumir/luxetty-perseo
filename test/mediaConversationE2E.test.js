const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInboundMessageContext, buildMediaAcknowledgementReply } = require('../conversation/mediaSignals');
const { buildUnifiedConversationContext } = require('../conversation/contextFusion');
const {
  detectLeadCreationOpportunity,
  createOrReuseLeadFromConversation,
} = require('../services/leadAutomation');

const textFixture = require('./fixtures/whatsapp/text-message.json');
const imageFixture = require('./fixtures/whatsapp/image-message.json');
const imageCaptionFixture = require('./fixtures/whatsapp/image-message-with-caption.json');
const audioFixture = require('./fixtures/whatsapp/audio-message.json');
const voiceFixture = require('./fixtures/whatsapp/voice-message.json');
const documentFixture = require('./fixtures/whatsapp/document-message.json');
const locationFixture = require('./fixtures/whatsapp/location-message.json');
const interactiveButtonFixture = require('./fixtures/whatsapp/interactive-button-message.json');
const interactiveListFixture = require('./fixtures/whatsapp/interactive-list-message.json');
const referralFixture = require('./fixtures/whatsapp/referral-property-message.json');
const stickerFixture = require('./fixtures/whatsapp/unsupported-sticker-message.json');

function makeQuery(table, db, filters = []) {
  const api = {
    _update: null,
    _inserted: null,
    _order: null,
    _limit: null,
    select() { return api; },
    insert(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      const inserted = rows.map((row) => ({
        id: row.id || `${table}-${db[table].length + 1 + Math.floor(Math.random() * 1000)}`,
        created_at: row.created_at || new Date().toISOString(),
        ...row,
      }));
      db[table].push(...inserted);
      api._inserted = inserted;
      return api;
    },
    update(payload) {
      api._update = payload;
      return api;
    },
    eq(key, value) {
      filters.push((row) => row[key] === value);
      return api;
    },
    is(key, value) {
      if (value === null) filters.push((row) => row[key] == null);
      else filters.push((row) => row[key] === value);
      return api;
    },
    or(raw) {
      const parts = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
      filters.push((row) => parts.some((part) => {
        const tokens = part.split('.eq.');
        if (tokens.length !== 2) return false;
        const [field, val] = tokens;
        return String(row[field] || '') === val;
      }));
      return api;
    },
    order(key, opts = {}) {
      api._order = { key, asc: !!opts.ascending };
      return api;
    },
    limit(n) {
      api._limit = n;
      return api;
    },
    async maybeSingle() {
      if (api._update) {
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    async single() {
      if (api._inserted) return { data: api._inserted[0], error: null };
      if (api._update) {
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    then(resolve) {
      if (api._update) {
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
        return resolve({ data: null, error: null });
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return resolve({ data: rows, error: null });
    },
  };

  return api;
}

function buildMockSupabase(db) {
  const events = [];

  return {
    _events: events,
    from(table) {
      if (!db[table]) db[table] = [];
      if (table === 'conversation_events') {
        return {
          insert(payload) {
            events.push(payload);
            db[table].push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }
      return makeQuery(table, db);
    },
    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }

      return {
        data: {
          success: true,
          lead_id: args.p_lead_id,
          assigned_agent_profile_id: 'agent-1',
          strategy: 'fallback',
          reason: 'fallback_agent',
        },
        error: null,
      };
    },
  };
}

function baseDb() {
  return {
    leads: [],
    contacts: [{ id: 'contact-1', whatsapp: '5218111111111', full_name: 'Cliente QA' }],
    conversations: [
      {
        id: 'conv-1',
        phone: '5218111111111',
        channel: 'whatsapp',
        lead_id: null,
        contact_id: 'contact-1',
        assigned_agent_profile_id: null,
      },
    ],
    conversation_events: [],
    pipeline_stages: [
      { id: 'stage-new-demand', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      { id: 'stage-new-supply', code: 'new', lead_type: 'supply', is_active: true, stage_order: 1 },
    ],
    lead_assignments: [],
    assignment_god_modes: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [],
    assignment_logs: [],
  };
}

function mapCategoryToLeadFlow(category) {
  if (['sell_property', 'rent_out_property', 'valuate_property'].includes(category)) return 'offer';
  if (['buy_property', 'rent_property', 'visit_property', 'ask_property_info'].includes(category)) return 'demand';
  return null;
}

function mapCategoryToOperation(category) {
  if (['rent_out_property', 'rent_property'].includes(category)) return 'rent';
  if (['sell_property', 'buy_property', 'valuate_property'].includes(category)) return 'sale';
  return null;
}

function mapConfidence(value) {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function buildAiStateFromUnified(unified, previousState = {}, extras = {}) {
  const category = unified.normalizedIntent.category;
  const leadFlow = mapCategoryToLeadFlow(category) || previousState.lead_flow || null;

  return {
    ...previousState,
    lead_flow: leadFlow,
    operation_type: mapCategoryToOperation(category) || previousState.operation_type || null,
    property_type: unified.propertyOffer.propertyType || unified.propertyDemand.propertyType || previousState.property_type || null,
    location_text: unified.propertyOffer.zone || unified.propertyDemand.zone || previousState.location_text || null,
    budget_max: unified.propertyOffer.askingPrice || unified.propertyDemand.budgetMax || previousState.budget_max || null,
    bedrooms: unified.propertyOffer.bedrooms || unified.propertyDemand.bedrooms || previousState.bedrooms || null,
    bathrooms: unified.propertyOffer.bathrooms || unified.propertyDemand.bathrooms || previousState.bathrooms || null,
    garage_spaces: unified.propertyOffer.parkingSpaces || unified.propertyDemand.parkingSpaces || previousState.garage_spaces || null,
    wants_human: !!unified.normalizedIntent.requiresHumanAdvisor || !!unified.normalizedIntent.userAcceptedAdvisor || !!previousState.wants_human,
    asks_property_details: category === 'ask_property_info' || !!previousState.asks_property_details,
    direct_property_reference: !!extras.propertyId || !!extras.propertyCode || !!previousState.direct_property_reference,
    property_code: extras.propertyCode || previousState.property_code || null,
    confidence: mapConfidence(unified.normalizedIntent.confidence || 0),
    context_fusion: {
      should_create_or_update_lead: unified.shouldCreateOrUpdateLead,
      normalizedIntent: unified.normalizedIntent,
      crmAction: unified.crmAction,
      sourceSignals: unified.sourceSignals,
      missingCriticalFields: unified.missingCriticalFields,
    },
  };
}

async function runLeadGateAndAutomation({ supabase, conversation, aiState, unified, messageText, propertyId = null, propertyCode = null, property = null }) {
  const decision = detectLeadCreationOpportunity({
    aiState,
    propertyId,
    propertyCode,
    messageText,
    hasCampaignContext: !!unified.sourceSignals.hasCampaignContext,
    unifiedContext: unified,
  });

  if (!decision.shouldCreate) {
    return { created: false, reason: decision.reason, lead: null };
  }

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation,
    aiState,
    contactId: conversation.contact_id,
    propertyId,
    property,
    logger: console,
  });

  if (result.success && result.leadId) {
    conversation.lead_id = result.leadId;
  }

  return {
    created: !!result.success,
    result,
    reason: decision.reason,
    lead: result.lead || null,
  };
}

test('E2E 1: imagen sola sin intencion no crea lead y responde consultivo', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(imageFixture);
  inbound.media.image_vision = {
    ok: true,
    status: 'analyzed',
    summary: 'Fachada de casa con porton.',
    propertySignals: {
      probablePropertyType: 'casa',
      visibleAreaType: 'fachada',
      apparentCondition: 'buena',
      confidence: 0.82,
    },
    suggestedFollowUp: '¿Buscas venderla, rentarla o buscar una propiedad similar?',
  };

  const reply = buildMediaAcknowledgementReply(inbound.media);
  const unified = buildUnifiedConversationContext({
    inboundText: '',
    imageVision: inbound.media.image_vision,
    previousAiState: {},
  });
  const aiState = buildAiStateFromUnified(unified);

  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: '',
  });

  assert.equal(lead.created, false);
  assert.match(reply, /ya pude revisar la imagen|recib[ií] la imagen/i);
  assert.doesNotMatch(reply, /archivo procesado|lead creado|ticket creado/i);
});

test('E2E 2: imagen con caption de venta fusiona y crea lead', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(imageCaptionFixture);
  inbound.media.image_vision = {
    ok: true,
    status: 'analyzed',
    summary: 'Fachada con cochera.',
    propertySignals: {
      probablePropertyType: 'casa',
      visibleAreaType: 'fachada',
      apparentCondition: 'regular',
      confidence: 0.72,
    },
  };

  const unified = buildUnifiedConversationContext({
    inboundText: inbound.messageText,
    caption: imageCaptionFixture.image.caption,
    imageVision: inbound.media.image_vision,
    previousAiState: {},
  });
  const aiState = buildAiStateFromUnified(unified);

  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: inbound.messageText,
  });

  assert.equal(unified.normalizedIntent.category, 'sell_property');
  assert.equal(lead.created, true);
  assert.equal(db.leads.length, 1);
  assert.equal(db.leads[0].lead_type, 'supply');
});

test('E2E 3: audio transcrito de venta crea/actualiza lead', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const text = 'Quiero vender mi casa en Cumbres, me gustaría pedir seis millones.';
  const unified = buildUnifiedConversationContext({
    inboundText: text,
    audioTranscription: text,
    previousAiState: {},
  });
  const aiState = buildAiStateFromUnified(unified);

  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: text,
  });

  assert.equal(unified.normalizedIntent.category, 'sell_property');
  assert.equal(lead.created, true);
  assert.equal(db.leads[0].lead_type, 'supply');
  assert.equal(aiState.location_text, 'cumbres');
});

test('E2E 4: audio transcrito de demanda renta crea/actualiza lead', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const text = 'Busco casa en renta en Cumbres, máximo veinte mil, tres recámaras.';
  const unified = buildUnifiedConversationContext({
    inboundText: text,
    audioTranscription: text,
    previousAiState: {},
  });
  const aiState = buildAiStateFromUnified(unified);

  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: text,
  });

  assert.equal(unified.normalizedIntent.category, 'rent_property');
  assert.equal(lead.created, true);
  assert.equal(db.leads[0].lead_type, 'demand');
});

test('E2E 5: texto + imagen + ubicacion actualiza mismo lead sin duplicar', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);
  let state = {};

  const step1 = buildUnifiedConversationContext({
    inboundText: 'Quiero vender mi casa',
    previousAiState: state,
  });
  state = buildAiStateFromUnified(step1, state);
  await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: state,
    unified: step1,
    messageText: 'Quiero vender mi casa',
  });

  const step2 = buildUnifiedConversationContext({
    inboundText: '',
    imageVision: {
      ok: true,
      summary: 'Fachada',
      propertySignals: { apparentCondition: 'buena', confidence: 0.75 },
    },
    previousAiState: state,
  });
  state = buildAiStateFromUnified(step2, state);
  await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: state,
    unified: step2,
    messageText: '',
  });

  const step3 = buildUnifiedConversationContext({
    inboundText: '',
    location: locationFixture.location,
    previousAiState: state,
  });
  state = buildAiStateFromUnified(step3, state);
  await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: state,
    unified: step3,
    messageText: '',
  });

  assert.equal(db.leads.length, 1);
  assert.ok(db.conversations[0].lead_id);
});

test('E2E 6: audio + imagen + aceptacion asesor conserva contexto y asigna', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);
  let state = {};

  const audioUnified = buildUnifiedConversationContext({
    inboundText: 'Estoy pensando vender mi casa',
    audioTranscription: 'Estoy pensando vender mi casa',
    previousAiState: state,
  });
  state = buildAiStateFromUnified(audioUnified, state);
  await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: state,
    unified: audioUnified,
    messageText: 'Estoy pensando vender mi casa',
  });

  const advisorUnified = buildUnifiedConversationContext({
    inboundText: 'Si, que me contacte un asesor',
    previousAiState: state,
  });
  state = buildAiStateFromUnified(advisorUnified, state);
  const result = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: state,
    unified: advisorUnified,
    messageText: 'Si, que me contacte un asesor',
  });

  assert.equal(result.created, true);
  assert.ok(result.result.leadId);
});

test('E2E 7: referral/property + me interesa usa contexto sin pedir todo desde cero', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const unified = buildUnifiedConversationContext({
    inboundText: referralFixture.text.body,
    campaignContext: {
      campaign_id: referralFixture.referral.campaign_id,
      ad_id: referralFixture.referral.ad_id,
    },
    propertyContext: {
      id: 'prop-campaign-1',
      listing_id: 'LUX-A0453',
      operation_type: 'sale',
      agent_profile_id: 'agent-campaign-1',
    },
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified, {}, { propertyId: 'prop-campaign-1', propertyCode: 'LUX-A0453' });
  const result = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: referralFixture.text.body,
    propertyId: 'prop-campaign-1',
    propertyCode: 'LUX-A0453',
    property: {
      id: 'prop-campaign-1',
      listing_id: 'LUX-A0453',
      operation_type: 'sale',
      agent_profile_id: 'agent-campaign-1',
    },
  });

  assert.equal(unified.normalizedIntent.category, 'ask_property_info');
  assert.equal(result.created, true);
});

test('E2E 8: imagen borrosa no concluyente no crea lead sola', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const unified = buildUnifiedConversationContext({
    inboundText: '',
    imageVision: {
      ok: true,
      summary: null,
      propertySignals: {
        probablePropertyType: 'unknown',
        visibleAreaType: 'unknown',
        apparentCondition: 'no_concluyente',
        confidence: 0.2,
      },
    },
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified);
  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: '',
  });

  assert.equal(lead.created, false);
});

test('E2E 9: audio fallido mantiene transparencia y no crea lead sin contexto', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(audioFixture);
  inbound.media.audio_without_transcription = true;

  const reply = buildMediaAcknowledgementReply(inbound.media);
  const unified = buildUnifiedConversationContext({
    inboundText: '',
    previousAiState: {},
  });
  const aiState = buildAiStateFromUnified(unified);

  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: '',
  });

  assert.equal(lead.created, false);
  assert.match(reply, /recib[ií] tu audio|transcribir/i);
});

test('E2E 10: documento PDF no finge lectura y no crea lead solo', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(documentFixture);
  const reply = buildMediaAcknowledgementReply(inbound.media);
  const unified = buildUnifiedConversationContext({
    inboundText: inbound.messageText,
    caption: documentFixture.document.caption,
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified);
  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: inbound.messageText,
  });

  assert.equal(lead.created, false);
  assert.match(reply, /recib[ií] el documento|referencia/i);
});

test('E2E 11: interactive button quiero vender se trata como senal textual', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(interactiveButtonFixture);
  const unified = buildUnifiedConversationContext({
    inboundText: inbound.messageText,
    interactive: interactiveButtonFixture.interactive.button_reply,
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified);
  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: inbound.messageText,
  });

  assert.equal(unified.normalizedIntent.category, 'sell_property');
  assert.equal(lead.created, false);
  assert.equal(unified.crmAction.action, 'request_more_info');
});

test('E2E 12: no interesado no crea lead nuevo', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const unified = buildUnifiedConversationContext({
    inboundText: 'No gracias, ya no me interesa',
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified);
  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: 'No gracias, ya no me interesa',
  });

  assert.equal(unified.normalizedIntent.category, 'not_interested');
  assert.equal(lead.created, false);
});

test('E2E 13: valuacion no da precio automatico y solo crea con asesor aceptado', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const unifiedNoAdvisor = buildUnifiedConversationContext({
    inboundText: 'En cuanto creen que se vende?',
    previousAiState: {},
  });
  const aiStateNoAdvisor = buildAiStateFromUnified(unifiedNoAdvisor);
  const noAdvisorLead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: aiStateNoAdvisor,
    unified: unifiedNoAdvisor,
    messageText: 'En cuanto creen que se vende?',
  });

  const unifiedWithAdvisor = buildUnifiedConversationContext({
    inboundText: 'Si, que me contacte un asesor para valuacion',
    previousAiState: aiStateNoAdvisor,
  });
  const aiStateWithAdvisor = buildAiStateFromUnified(unifiedWithAdvisor, aiStateNoAdvisor);
  const advisorLead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState: aiStateWithAdvisor,
    unified: unifiedWithAdvisor,
    messageText: 'Si, que me contacte un asesor para valuacion',
  });

  assert.equal(noAdvisorLead.created, false);
  assert.equal(advisorLead.created, true);
});

test('E2E 14: varios audios seguidos fusionan contexto y no duplican lead', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);
  let state = {};

  const steps = [
    'Quiero vender.',
    'Esta en Cumbres.',
    'Quiero pedir seis millones.',
  ];

  for (const step of steps) {
    const unified = buildUnifiedConversationContext({
      inboundText: step,
      audioTranscription: step,
      previousAiState: state,
    });

    state = buildAiStateFromUnified(unified, state);

    await runLeadGateAndAutomation({
      supabase,
      conversation: db.conversations[0],
      aiState: state,
      unified,
      messageText: step,
    });
  }

  assert.equal(db.leads.length, 1);
  assert.equal(state.location_text, 'cumbres');
  assert.equal(state.budget_max, 6000000);
});

test('E2E 15: texto normal previo sigue funcionando', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const inbound = buildInboundMessageContext(textFixture);
  const unified = buildUnifiedConversationContext({
    inboundText: inbound.messageText,
    previousAiState: {},
  });

  const aiState = buildAiStateFromUnified(unified);
  const lead = await runLeadGateAndAutomation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    unified,
    messageText: inbound.messageText,
  });

  assert.equal(unified.normalizedIntent.category, 'buy_property');
  assert.equal(lead.created, true);
});

test('E2E extras: coverage de fixtures voice/list/sticker', () => {
  const voiceInbound = buildInboundMessageContext(voiceFixture);
  const listInbound = buildInboundMessageContext(interactiveListFixture);
  const stickerInbound = buildInboundMessageContext(stickerFixture);

  assert.equal(voiceInbound.messageType, 'voice');
  assert.equal(listInbound.media.category, 'interactive');
  assert.equal(stickerInbound.media.category, 'sticker');
});
