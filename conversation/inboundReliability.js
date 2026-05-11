const { cleanSpaces, normalizeText } = require('../utils/text');
const { extractInboundSignalText } = require('./mediaIngestion');

const DEFAULT_BURST_WINDOW_MS = 2500;

function getMessageMetaTimestampMs(message = {}) {
  const raw = Number(message?.timestamp);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw > 9999999999 ? Math.floor(raw) : raw * 1000;
}

function pickSignalText(message = {}) {
  const direct = cleanSpaces(extractInboundSignalText(message) || '');
  if (direct) return direct;

  if (typeof message?.text?.body === 'string') {
    return cleanSpaces(message.text.body);
  }

  return '';
}

function consolidateInboundBurst(items = []) {
  const sorted = [...(Array.isArray(items) ? items : [])]
    .filter((item) => item && item.message)
    .map((item, index) => {
      const timestampMs = getMessageMetaTimestampMs(item.message);
      const messageId = item.message.id || null;
      const signalText = pickSignalText(item.message);
      return {
        ...item,
        _index: index,
        _timestampMs: timestampMs,
        _messageId: messageId,
        _signalText: signalText,
      };
    })
    .sort((a, b) => {
      const ta = a._timestampMs || Number.MAX_SAFE_INTEGER;
      const tb = b._timestampMs || Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return a._index - b._index;
    });

  const deduped = [];
  const seenMessageIds = new Set();

  for (const item of sorted) {
    if (item._messageId && seenMessageIds.has(item._messageId)) continue;
    if (item._messageId) seenMessageIds.add(item._messageId);
    deduped.push(item);
  }

  const burstTexts = deduped
    .map((item) => item._signalText)
    .filter(Boolean);

  return {
    items: deduped,
    inboundBatch: deduped.map((item) => ({
      meta_message_id: item._messageId,
      message_type: item.message?.type || null,
      timestamp_ms: item._timestampMs,
      text: item._signalText || null,
    })),
    combinedText: burstTexts.join('\n').trim() || null,
  };
}

function detectCriticalSaleIntent(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    normalized.includes('quiero vender') ||
    normalized.includes('vender mi casa') ||
    normalized.includes('vender mi propiedad') ||
    normalized.includes('quiero saber como vender') ||
    normalized.includes('quiero saber cómo vender') ||
    normalized.includes('quiero valuar para vender')
  );
}

function detectExplicitRentSwitch(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    normalized.includes('mejor la quiero rentar') ||
    normalized.includes('tambien quiero rentarla') ||
    normalized.includes('también quiero rentarla') ||
    normalized.includes('quiero vender o rentar')
  );
}

function detectComplaintCorrection(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    normalized.includes('no entendiste') ||
    normalized.includes('eso no dije') ||
    normalized.includes('te equivocaste') ||
    normalized.includes('dije vender') ||
    normalized.includes('no quiero rentar') ||
    normalized.includes('eres un bot') ||
    normalized.includes('estas mal') ||
    normalized.includes('estás mal')
  );
}

/**
 * Frases de apertura comercial (captación / consulta inicial).
 * No deben activar cierre tipo "commercial_close" — el cierre es solo para
 * confirmaciones explícitas o pedidos directos de contacto/agenda.
 */
function detectOpeningCommercialIntent(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    normalized.includes('quiero vender') ||
    normalized.includes('vender mi casa') ||
    normalized.includes('vender mi propiedad') ||
    normalized.includes('vender mi depa') ||
    normalized.includes('vender mi departamento') ||
    normalized.includes('quiero valuar') ||
    normalized.includes('quiero mas informacion') ||
    normalized.includes('quiero más información') ||
    normalized.includes('quiero vender pero') ||
    normalized.includes('no se cuanto vale') ||
    normalized.includes('no se cuanto') ||
    normalized.includes('cuanto vale mi')
  );
}

/** Señales de cierre / handoff explícito (no confundir con apertura de venta o valuación). */
function detectCommercialCloseSignal(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const exactAffirmatives = new Set(['si', 'sí', 'correcto', 'me interesa']);
  if (exactAffirmatives.has(normalized)) return true;

  return (
    normalized.includes('ese es mi numero') ||
    normalized.includes('ese es mi número') ||
    normalized.includes('ese es mi whatsapp') ||
    normalized.includes('correcto, ese es mi whatsapp') ||
    normalized.includes('correcto ese es mi whatsapp') ||
    normalized.includes('quiero verla') ||
    normalized.includes('agendame') ||
    normalized.includes('agéndame') ||
    normalized.includes('que me contacten') ||
    normalized.includes('que me contacte un asesor') ||
    normalized.includes('que me contacte una asesora') ||
    normalized.includes('contacte un asesor') ||
    normalized.includes('contacte una asesora') ||
    normalized.includes('quiero hablar con un asesor') ||
    normalized.includes('quiero hablar con una asesora') ||
    normalized.includes('hablar con un asesor') ||
    normalized.includes('hablar con una asesora') ||
    normalized.includes('mandame info') ||
    normalized.includes('mándame info')
  );
}

function evaluateCommercialCloseDecision({
  text = '',
  state = {},
  campaignContext = null,
  hasPropertyContext = false,
} = {}) {
  const normalized = normalizeText(text);

  if (detectOpeningCommercialIntent(normalized)) {
    return {
      shouldClose: false,
      shouldClarify: false,
      reason: 'opening_commercial_intent_not_close',
    };
  }

  const hasSignal = detectCommercialCloseSignal(normalized);
  if (!hasSignal) {
    return {
      shouldClose: false,
      shouldClarify: false,
      reason: 'no_close_signal',
    };
  }

  const hasDemandContext = state?.lead_flow === 'demand';
  const hasOfferContext = state?.lead_flow === 'offer';
  const hasIntentContext =
    hasDemandContext ||
    hasOfferContext ||
    !!state?.last_clear_intent ||
    !!state?.current_intent ||
    !!campaignContext ||
    !!hasPropertyContext;

  if (!hasIntentContext) {
    return {
      shouldClose: false,
      shouldClarify: true,
      reason: 'close_signal_without_context',
      clarificationQuestion: 'Claro, te ayudo con gusto. ¿Buscas comprar, rentar, vender o valuar una propiedad?',
    };
  }

  return {
    shouldClose: true,
    shouldClarify: false,
    reason: hasPropertyContext
      ? 'property_context_close'
      : hasOfferContext
      ? 'seller_context_close'
      : hasDemandContext
      ? 'buyer_context_close'
      : 'campaign_context_close',
  };
}

function chooseSingleUsefulQuestion(state = {}) {
  if (!state.property_type) {
    return 'Para ayudarte mejor, ¿me confirmas si es casa, departamento o terreno?';
  }

  if (!state.location_text && !state.location_any) {
    return '¿En qué zona o colonia está la propiedad?';
  }

  if (state.asking_price == null && state.expected_price == null && state.budget_max == null) {
    return '¿Cuál es el precio que tienes en mente para publicarla?';
  }

  if (!state.full_name) {
    return '¿Me compartes tu nombre para continuar con el seguimiento?';
  }

  return '¿Cuál es el dato más importante que quieres que priorice ahora?';
}

function applyConversationIntentMemory({ text, previousAiState = {}, incomingSignals = {}, nextAiState = {} }) {
  const normalizedText = cleanSpaces(text || '');
  const hasCriticalSaleIntent = detectCriticalSaleIntent(normalizedText);
  const explicitRentSwitch = detectExplicitRentSwitch(normalizedText);

  const prevLock = previousAiState?.intent_lock_sale_owner === true;
  const shouldLockSaleOwner = hasCriticalSaleIntent || (prevLock && !explicitRentSwitch);

  if (shouldLockSaleOwner) {
    nextAiState.lead_flow = 'offer';
    nextAiState.operation_type = 'sale';
    nextAiState.lead_role = 'owner';
    nextAiState.intent_lock_sale_owner = true;
    nextAiState.last_clear_intent = 'sell_property';
  }

  if (explicitRentSwitch) {
    nextAiState.intent_lock_sale_owner = false;
    nextAiState.last_clear_intent = 'rent_out_property';
    nextAiState.operation_type = 'rent';
    nextAiState.lead_flow = 'offer';
  }

  nextAiState.current_intent = incomingSignals?.intent_type || nextAiState.current_intent || null;
  nextAiState.contact_name = nextAiState.full_name || nextAiState.contact_name || null;
  nextAiState.preferred_contact_channel =
    nextAiState.contact_preference || nextAiState.preferred_contact_channel || null;
  nextAiState.confirmed_phone =
    nextAiState.contact_number_confirmed === true
      ? true
      : nextAiState.confirmed_phone === true
      ? true
      : null;

  if (nextAiState.location_text && !nextAiState.zone) {
    nextAiState.zone = nextAiState.location_text;
  }

  if (nextAiState.expected_price != null && nextAiState.asking_price == null) {
    nextAiState.asking_price = nextAiState.expected_price;
  }

  if (nextAiState.urgency_level && !nextAiState.urgency) {
    nextAiState.urgency = nextAiState.urgency_level;
  }

  return {
    hasCriticalSaleIntent,
    explicitRentSwitch,
    isComplaintCorrection: detectComplaintCorrection(normalizedText),
  };
}

function buildConversationContextSnapshot({
  recentMessages = [],
  inboundBatch = [],
  aiState = {},
  campaignContext = null,
  propertyContext = null,
  contactContext = null,
  leadContext = null,
}) {
  return {
    recentMessages,
    inboundBatch,
    lastClearIntent: aiState?.last_clear_intent || null,
    slots: {
      operation_type: aiState?.operation_type || null,
      lead_role: aiState?.lead_role || null,
      property_type: aiState?.property_type || null,
      zone: aiState?.zone || aiState?.location_text || null,
      budget_min: aiState?.budget_min ?? null,
      budget_max: aiState?.budget_max ?? null,
      asking_price: aiState?.asking_price ?? aiState?.expected_price ?? null,
      urgency: aiState?.urgency || aiState?.urgency_level || null,
      property_code: aiState?.property_code || null,
      campaign_context: aiState?.campaign_context || null,
      contact_name: aiState?.contact_name || aiState?.full_name || null,
      preferred_contact_channel:
        aiState?.preferred_contact_channel || aiState?.contact_preference || null,
      confirmed_phone:
        aiState?.confirmed_phone != null
          ? aiState.confirmed_phone
          : aiState?.contact_number_confirmed,
      current_intent: aiState?.current_intent || aiState?.intent_type || null,
      last_clear_intent: aiState?.last_clear_intent || null,
      pending_question:
        aiState?.pending_question || aiState?.context_fusion?.pending_question || null,
    },
    campaignContext,
    propertyContext,
    contactContext,
    leadContext,
  };
}

module.exports = {
  DEFAULT_BURST_WINDOW_MS,
  consolidateInboundBurst,
  applyConversationIntentMemory,
  buildConversationContextSnapshot,
  chooseSingleUsefulQuestion,
  detectComplaintCorrection,
  detectOpeningCommercialIntent,
  detectCommercialCloseSignal,
  evaluateCommercialCloseDecision,
};
