'use strict';

/**
 * Matriz QA P0 — conversaciones simuladas tipo WhatsApp (multi-turno).
 * Usa parsers, intent, stateUpdater, responseBuilder y namePrompt como en producción.
 * No reemplaza pruebas E2E con Meta/OpenAI; valida continuidad, tono y políticas de nombre.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectIntent } = require('../conversation/intent');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const {
  buildDemandReply,
  buildOfferReply,
  buildPropertyPriceReply,
  buildLowInfoCampaignReply,
  buildFinalHandoffReply,
} = require('../conversation/responseBuilder');
const { evaluateCommercialCloseDecision } = require('../conversation/inboundReliability');
const { isGreetingOnly } = require('../utils/messageChecks');
const { appendNameRequestIfNeeded, hasValidHumanName } = require('../conversation/namePrompt');
const { PROPERTY_LUX_A0453 } = require('./fixtures/perseoRegressionFixtures');

const WRONG_CHANNEL_RE = /Gracias por escribir\. Para ayudarte bien, este canal atiende/i;
const BOT_RE = /soy un bot|no puedo ayudarte|error interno/i;

function isClosureCheck(text) {
  const t = normalizeText(text);
  return (
    t.includes('es todo') ||
    t.includes('algo mas') ||
    t.includes('algo más') ||
    t === 'bueno' ||
    t === 'ok' ||
    t === 'gracias' ||
    t === 'listo'
  );
}

function isNonRealEstateCategoryState(state = {}) {
  return (
    !!state.external_broker ||
    !!state.provider ||
    !!state.spam_detected ||
    !!state.wrong_context ||
    !!state.unclear_non_real_estate ||
    !!state.non_real_estate_or_provider
  );
}

function buildNonRealEstateCategoryReply(state = {}) {
  if (state.spam_detected) {
    return 'Gracias por tu mensaje. Este canal atiende únicamente solicitudes inmobiliarias de compra, venta, renta y valuación.';
  }
  if (state.external_broker) {
    return 'Gracias por escribir. Este canal está enfocado en atención directa a clientes de Luxetty. Si gustas, puedo canalizarte con el área comercial interna.';
  }
  if (state.provider) {
    return 'Gracias por contactarnos. Este chat está enfocado en clientes inmobiliarios; para temas de proveedores te canalizamos por el medio interno correspondiente.';
  }
  if (state.wrong_context || state.unclear_non_real_estate) {
    return 'Gracias por escribir. Para ayudarte bien, este canal atiende compra, venta, renta y valuación de propiedades.';
  }
  return 'Gracias por tu mensaje. Este canal atiende únicamente solicitudes inmobiliarias de compra, venta, renta y valuación.';
}

function replyToString(reply) {
  if (Array.isArray(reply)) return reply.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
  return cleanSpaces(String(reply || ''));
}

function maybePatchOfferAwaitingLocation(reply, next) {
  const t = replyToString(reply);
  if (next.lead_flow === 'offer' && /zona|ubicaci|colonia|municipio/i.test(t) && !next.awaiting_field) {
    next.awaiting_field = 'location_text';
  }
}

function produceCoreReply({
  userText,
  prevAiState,
  nextAiState,
  signals,
  changeType,
  campaignContext,
  matchedProperty,
  matchedProperties,
}) {
  const normalizedText = normalizeText(userText);

  if (nextAiState.handoff_sent && isClosureCheck(userText)) {
    return 'Gracias a ti. Si surge algo más, aquí estoy para seguirte orientando con gusto.';
  }

  if (isNonRealEstateCategoryState(nextAiState)) {
    return buildNonRealEstateCategoryReply(nextAiState);
  }

  const closeDecision = evaluateCommercialCloseDecision({
    text: userText,
    state: nextAiState,
    campaignContext: campaignContext || null,
    hasPropertyContext: !!(
      nextAiState.direct_property_reference ||
      nextAiState.property_code ||
      (campaignContext && campaignContext.property_code)
    ),
  });

  if (closeDecision.shouldClarify && closeDecision.clarificationQuestion) {
    return closeDecision.clarificationQuestion;
  }
  if (closeDecision.shouldClose) {
    return 'Perfecto. Voy a canalizar tu solicitud con un asesor de Luxetty para que te apoye con la información y próximos pasos.';
  }

  if (signals.complaint_followup) {
    return 'Tienes razón, retomo con calma. ¿Me das un dato más concreto para orientarte mejor?';
  }

  if (signals.low_info_campaign_message && !signals.lead_flow && campaignContext) {
    return buildLowInfoCampaignReply(true, campaignContext);
  }

  if (isGreetingOnly(userText) && !prevAiState.lead_flow && !signals.property_code) {
    return 'Hola, bienvenido a Luxetty 😊\n¿En qué puedo orientarte hoy? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
  }

  if (
    nextAiState.lead_flow === 'demand' &&
    nextAiState.direct_property_reference &&
    matchedProperty &&
    /precio|cuanto|cuesta|disponible|ubicaci/i.test(normalizedText)
  ) {
    if (/precio|cuanto|cuesta/i.test(normalizedText)) {
      return buildPropertyPriceReply(matchedProperty, nextAiState);
    }
  }

  if (nextAiState.lead_flow === 'demand' && matchedProperties && matchedProperties.length) {
    return buildDemandReply(nextAiState, changeType, matchedProperties, 'direct_property_code');
  }

  if (nextAiState.lead_flow === 'demand') {
    return buildDemandReply(nextAiState, changeType, matchedProperties || [], null);
  }

  if (nextAiState.lead_flow === 'offer') {
    return buildOfferReply(nextAiState, changeType, { signals, text: userText });
  }

  return 'Claro, te apoyo con gusto. Para orientarte mejor, ¿buscas comprar, rentar, vender o una valuación?';
}

function applyNameLayer(reply, { contact, nextAiState, outboundHistory, userText, waProfile }) {
  const { messages, statePatch, setAwaitingFullName } = appendNameRequestIfNeeded(reply, {
    contact,
    aiState: nextAiState,
    waProfileDisplayName: waProfile || null,
    recentOutboundTexts: outboundHistory.slice(-4),
    userInboundText: userText,
    leadFlow: nextAiState.lead_flow,
    wantsVisit: !!nextAiState.wants_visit,
  });
  Object.assign(nextAiState, statePatch);
  if (setAwaitingFullName && (!nextAiState.awaiting_field || nextAiState.awaiting_field === 'full_name')) {
    nextAiState.awaiting_field = 'full_name';
  }
  return messages;
}

/**
 * Un turno usuario → asistente (sincronizado con builders reales).
 */
function simulateTurn({
  userText,
  aiState,
  contact,
  outboundHistory,
  waProfile,
  campaignContext,
  matchedProperty,
  forceHandoffSent,
}) {
  const prev = normalizeAiState(aiState);
  const inboundContext = {};
  const signals = parseMessageSignals(userText, prev, inboundContext);
  const changeType = detectStateChange(prev, signals);
  let next = buildNextState(prev, signals, changeType);

  if (forceHandoffSent) next.handoff_sent = true;

  const matchedProperties = matchedProperty ? [matchedProperty] : [];

  let reply = produceCoreReply({
    userText,
    prevAiState: prev,
    nextAiState: next,
    signals,
    changeType,
    campaignContext,
    matchedProperty,
    matchedProperties,
  });

  maybePatchOfferAwaitingLocation(reply, next);

  reply = applyNameLayer(reply, {
    contact,
    nextAiState: next,
    outboundHistory,
    userText,
    waProfile,
  });

  const assistantText = replyToString(reply);
  const nextOutbound = [...outboundHistory, assistantText];

  return {
    assistantText,
    aiState: next,
    signals,
    outboundHistory: nextOutbound,
  };
}

function defaultChecks(assistantText, { requireName, allowWrongChannel }) {
  const obs = [];
  let pass = true;
  if (!assistantText || assistantText.length < 8) {
    pass = false;
    obs.push('FAIL: respuesta vacía o demasiado corta (silencio).');
  }
  if (BOT_RE.test(assistantText)) {
    pass = false;
    obs.push('FAIL: tono robótico o rechazo genérico.');
  }
  if (!allowWrongChannel && WRONG_CHANNEL_RE.test(assistantText)) {
    pass = false;
    obs.push('FAIL: mensaje tipo “canal equivocado” / unclear_non_real_estate inapropiado.');
  }
  if (requireName && !/nombre|cómo te llamas|registro como|registrarte como/i.test(assistantText)) {
    pass = false;
    obs.push('FAIL: falta pedir nombre de forma natural cuando no hay nombre válido.');
  }
  if (/^\s*¿(?:cuál es tu nombre|quien eres)\?\s*$/i.test(assistantText.trim())) {
    pass = false;
    obs.push('FAIL: solo pregunta de nombre sin ayuda principal.');
  }
  return { pass, obs };
}

const CONTACT_NO_NAME = { first_name: 'Cliente', last_name: '' };
const CONTACT_VALID = { first_name: 'Mariana', last_name: 'Ruiz' };

const SCENARIOS = [
  {
    id: 'QA-01',
    title: 'Saludo + seguimiento “Info” (continuidad + nombre)',
    contact: CONTACT_NO_NAME,
    turns: [
      {
        user: 'Hola',
        requireName: true,
        allowWrongChannel: true,
      },
      {
        user: 'Info',
        requireName: false,
        extraCheck: (t) =>
          !WRONG_CHANNEL_RE.test(t) && t.length > 30 && /comprar|rentar|vender|valuaci|orientarte|asesor/i.test(t),
      },
    ],
  },
  {
    id: 'QA-02',
    title: 'Propiedad LUX-A0453 + pregunta de precio',
    contact: CONTACT_NO_NAME,
    matchedProperty: PROPERTY_LUX_A0453,
    turns: [
      {
        user: 'Me interesa la propiedad LUX-A0453',
        requireName: true,
        patchAfter: (s) => {
          s.aiState.direct_property_reference = true;
          s.aiState.property_code = 'LUX-A0453';
          s.aiState.lead_flow = 'demand';
        },
      },
      { user: '¿Cuál es el precio?', requireName: true },
    ],
  },
  {
    id: 'QA-03',
    title: 'Captación venta + solo municipio (sin “canal equivocado”)',
    contact: CONTACT_NO_NAME,
    turns: [
      { user: 'Quiero vender mi casa', requireName: true },
      { user: 'Apodaca', requireName: true },
    ],
  },
  {
    id: 'QA-04',
    title: 'Visita explícita + nombre',
    contact: CONTACT_NO_NAME,
    matchedProperty: PROPERTY_LUX_A0453,
    turns: [
      {
        user: 'Me interesa LUX-A0453 y quiero verla',
        requireName: true,
        patchAfter: (s) => {
          s.aiState.direct_property_reference = true;
          s.aiState.property_code = 'LUX-A0453';
          s.aiState.lead_flow = 'demand';
          s.aiState.wants_visit = true;
        },
      },
    ],
  },
  {
    id: 'QA-05',
    title: 'Handoff previo + “gracias” (sin silencio + nombre si falta)',
    contact: CONTACT_NO_NAME,
    forceHandoffSent: true,
    turns: [{ user: 'gracias', requireName: true, allowWrongChannel: true }],
  },
  {
    id: 'QA-06',
    title: 'Campaña listing + “me interesa” (contexto pauta)',
    contact: CONTACT_NO_NAME,
    campaignContext: { campaign_type: 'property_listing', property_code: 'LUX-A0453' },
    turns: [
      {
        user: 'Me interesa',
        requireName: true,
        patchBefore: (base) => {
          base.low_info_campaign_message = true;
        },
      },
    ],
  },
  {
    id: 'QA-07',
    title: 'Disponibilidad sobre propiedad en contexto',
    contact: CONTACT_NO_NAME,
    matchedProperty: PROPERTY_LUX_A0453,
    turns: [
      {
        user: '¿Sigue disponible LUX-A0453?',
        requireName: true,
        patchAfter: (s) => {
          s.aiState.lead_flow = 'demand';
          s.aiState.direct_property_reference = true;
          s.aiState.property_code = 'LUX-A0453';
        },
      },
    ],
  },
  {
    id: 'QA-08',
    title: 'Ubicación / zona (demanda)',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Busco casa en Cumbres', requireName: true }],
  },
  {
    id: 'QA-09',
    title: 'Valuación (oferta)',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Quiero valuar mi casa en San Pedro', requireName: true }],
  },
  {
    id: 'QA-10',
    title: 'Comisión (tono consultivo, sin inventar)',
    contact: CONTACT_NO_NAME,
    initialState: { lead_flow: 'offer', operation_type: 'sale', owner_relation: 'owner' },
    turns: [{ user: '¿Cuánto cobran de comisión?', requireName: true }],
  },
  {
    id: 'QA-11',
    title: 'Follow-up contextual: zona luego presupuesto',
    contact: CONTACT_NO_NAME,
    turns: [
      { user: 'Busco en Cumbres', requireName: true },
      {
        user: 'Hasta 5 millones',
        requireName: false,
        extraCheck: (t) =>
          !WRONG_CHANNEL_RE.test(t) &&
          (/millones|presupuesto|buscar|opciones|zona|cumbres|orientarte/i.test(t) || /nombre/i.test(t)),
      },
    ],
  },
  {
    id: 'QA-12',
    title: 'Demanda genérica + refinamiento',
    contact: CONTACT_NO_NAME,
    turns: [
      { user: 'Busco depa', requireName: true },
      {
        user: 'En San Pedro, 3 recámaras',
        requireName: false,
        extraCheck: (t) =>
          !WRONG_CHANNEL_RE.test(t) &&
          (/san pedro|recamara|recámara|presupuesto|zona|orientarte|opciones/i.test(t) || /nombre/i.test(t)),
      },
    ],
  },
  {
    id: 'QA-13',
    title: '“Solo dame el precio” con contexto demanda/propiedad',
    contact: CONTACT_NO_NAME,
    matchedProperty: PROPERTY_LUX_A0453,
    initialState: { lead_flow: 'demand', direct_property_reference: true, property_code: 'LUX-A0453' },
    turns: [{ user: 'Solo dame el precio', requireName: true }],
  },
  {
    id: 'QA-14',
    title: 'Venta + urgencia (captación)',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Me urge vender mi casa en Cumbres', requireName: true }],
  },
  {
    id: 'QA-15',
    title: 'Propiedad intestada (señal legal, sin silencio)',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Quiero vender pero está intestada', requireName: true }],
  },
  {
    id: 'QA-16',
    title: 'Crédito hipotecario pendiente',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Quiero vender y todavía tengo crédito', requireName: true }],
  },
  {
    id: 'QA-17',
    title: 'Ocupada por inquilino',
    contact: CONTACT_NO_NAME,
    turns: [{ user: 'Quiero vender mi casa pero está ocupada', requireName: true }],
  },
  {
    id: 'QA-18',
    title: 'Ya publicada y no se vende',
    contact: CONTACT_NO_NAME,
    initialState: { lead_flow: 'offer', operation_type: 'sale' },
    turns: [{ user: 'Ya la tengo publicada y no se vende', requireName: true }],
  },
  {
    id: 'QA-19',
    title: 'Contacto con nombre válido: no insistir en nombre',
    contact: CONTACT_VALID,
    turns: [
      {
        user: 'Hola, busco casa',
        requireName: false,
        extraCheck: (t) => !/compartes tu nombre|cómo te llamas/i.test(t),
      },
    ],
  },
  {
    id: 'QA-20',
    title: 'Perfil WA útil + placeholder contacto (confirmación)',
    contact: CONTACT_NO_NAME,
    waProfile: 'Carlos López',
    turns: [
      {
        user: 'Hola',
        requireName: true,
        extraCheck: (t) => /registro como|registrarte como/i.test(t) || /nombre/i.test(t),
      },
    ],
  },
];

function runScenario(scenario) {
  let aiState = normalizeAiState({ ...getDefaultAiState(), ...(scenario.initialState || {}) });
  const contact = scenario.contact || CONTACT_NO_NAME;
  let outboundHistory = [];
  const transcript = [];
  const observations = [];
  let scenarioPass = true;

  scenario.turns.forEach((turn, idx) => {
    if (turn.patchBefore) {
      turn.patchBefore(aiState);
    }

    const res = simulateTurn({
      userText: turn.user,
      aiState,
      contact,
      outboundHistory,
      waProfile: scenario.waProfile,
      campaignContext: scenario.campaignContext,
      matchedProperty: scenario.matchedProperty,
      forceHandoffSent: scenario.forceHandoffSent && idx === 0,
    });

    aiState = res.aiState;
    outboundHistory = res.outboundHistory;

    if (turn.patchAfter) {
      turn.patchAfter({ aiState, outboundHistory });
    }

    transcript.push({ role: 'user', text: turn.user });
    transcript.push({ role: 'assistant', text: res.assistantText });

    const requireName = turn.requireName !== false && !hasValidHumanName(contact, aiState);
    const chk = defaultChecks(res.assistantText, {
      requireName,
      allowWrongChannel: !!turn.allowWrongChannel,
    });
    if (!chk.pass) {
      scenarioPass = false;
      observations.push(...chk.obs);
    }
    if (turn.extraCheck && !turn.extraCheck(res.assistantText)) {
      scenarioPass = false;
      observations.push(`FAIL: criterio extra turno ${idx + 1}.`);
    }
  });

  if (scenarioPass && observations.length === 0) {
    observations.push('PASS: continuidad, tono y política de nombre coherentes con el escenario.');
  }

  return {
    id: scenario.id,
    title: scenario.title,
    pass: scenarioPass,
    observations: observations.join(' '),
    transcript,
  };
}

function runAllMatrix() {
  return SCENARIOS.map(runScenario);
}

function formatMarkdownTable(results) {
  const lines = [
    '# Matriz QA P0 — conversaciones simuladas (WhatsApp)',
    '',
    '| ID | Escenario | Resultado | Observaciones |',
    '|----|-----------|-----------|---------------|',
  ];
  for (const r of results) {
    const obs = String(r.observations || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${r.pass ? '**PASS**' : '**FAIL**'} | ${obs} |`);
  }
  lines.push('');
  lines.push('## Transcripts');
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.title}`);
    lines.push('');
    for (const line of r.transcript) {
      lines.push(`- **${line.role}:** ${line.text}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  SCENARIOS,
  simulateTurn,
  runScenario,
  runAllMatrix,
  formatMarkdownTable,
  defaultChecks,
};
