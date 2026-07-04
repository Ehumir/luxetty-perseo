'use strict';

/**
 * P0.1 — Anti-loop guardrails (determinista, sin CRM, sin schema nuevo).
 * Reduce repeticiones de preguntas, saludos genéricos, fallback en bucle y awaiting_field obsoleto.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');

const FRUSTRATION_MARKERS = [
  { re: /\bya te dij/i, id: 'ya_te_dije' },
  { re: /\bya lo dij/i, id: 'ya_lo_dije' },
  { re: /\botra vez\b/i, id: 'otra_vez' },
  { re: /me est[aá]s preguntando lo mismo/i, id: 'misma_pregunta' },
  { re: /\bya respond[ií]\b/i, id: 'ya_respondi' },
  { re: /\blee bien\b/i, id: 'lee_bien' },
  { re: /\bhola\?{2,}/i, id: 'hola_insist' },
  { re: /\bno entiendes\b/i, id: 'no_entiendes' },
  { re: /\bte acabo de decir\b/i, id: 'acabo_de_decir' },
  { re: /\bme repites\b/i, id: 'me_repites' },
  { re: /\bno me lees\b/i, id: 'no_me_lees' },
  { re: /\best[aá]\s+repitiendo\b/i, id: 'esta_repitiendo' },
  { re: /\brepitiendo\s+todo\b/i, id: 'repitiendo_todo' },
  { re: /\bno\s+repitas\b/i, id: 'no_repitas' },
  { re: /\blo\s+mismo\b/i, id: 'lo_mismo' },
];

function detectConversationalFrustration(text = '') {
  const raw = cleanSpaces(String(text || ''));
  if (!raw) return { frustrated: false, markers: [] };
  const t = normalizeText(raw);
  const markers = [];
  for (const m of FRUSTRATION_MARKERS) {
    if (m.re.test(t)) markers.push(m.id);
  }
  return { frustrated: markers.length > 0, markers };
}

/**
 * Clasificación liviana del inbound para anti-loop de fallback: evita contar “Hola” y “info”
 * como la misma “repetición” cuando el bucket saliente es idéntico (p. ej. generic_help).
 * @returns {string}
 */
function classifyInboundShortIntent(text = '') {
  const raw = cleanSpaces(String(text || ''));
  if (!raw) return 'empty';
  if (detectConversationalFrustration(raw).frustrated) return 'frustration_marker';
  const t = normalizeText(raw);
  if (t === 'hola' || t === 'buenas' || t === 'hey' || t === 'hi') return 'greeting_hola';
  if (
    /^(hola|hey|hi|buenas|buenos dias|buenos días|buenas tardes|buenas noches)\b/.test(t) &&
    t.length < 48
  ) {
    return 'greeting_hola';
  }
  if (
    t.includes('vi su pagina') ||
    t.includes('vi su página') ||
    t.includes('vi facebook') ||
    t.includes('navegando en facebook') ||
    t.includes('vi su anuncio') ||
    t.includes('pagina inmobiliaria') ||
    t.includes('página inmobiliaria') ||
    (t.includes('facebook') && t.includes('vi ')) ||
    (t.includes('instagram') && t.includes('vi '))
  ) {
    return 'social_page_visit';
  }
  if (t === 'info' || t === 'informacion' || t === 'información') return 'opening_info';
  if (t === 'me interesa' || t === 'me interesa.') return 'opening_me_interesa';
  if (t === 'ok' || t === 'vale' || t === 'si' || t === 'sí' || t === 'gracias') return 'ack_short';
  if (t.includes('precio') || t.includes('cuesta') || t.includes('cuanto') || t.includes('cuánto')) return 'topic_price';
  if (t.includes('disponibilidad') || t.includes('disponible')) return 'topic_disponibilidad';
  if (t.includes('vender') || t.includes('venta') || t.includes('valu') || t.includes('promover')) {
    return 'intent_sale';
  }
  if (t.includes('busco') || t.includes('comprar') || t.includes('rentar') || t.includes('renta')) return 'intent_search';
  if (raw.length <= 2) return 'ultra_short';
  return 'other';
}

function normalizeOutboundSignature(text = '') {
  const t = normalizeText(String(text || ''));
  return t.replace(/\s+/g, ' ').trim().slice(0, 420);
}

function mergeReplyText(reply) {
  if (Array.isArray(reply)) {
    return reply.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
  }
  return cleanSpaces(String(reply || ''));
}

/**
 * Tipos de “pregunta” saliente para evitar repetir la misma intención conversacional.
 * @returns {string}
 */
function classifyOutboundQuestionKind(replyText = '') {
  const t = normalizeText(String(replyText || ''));
  if (!t) return 'none';

  if (
    t.includes('compartes tu nombre') ||
    t.includes('comparteme tu nombre') ||
    t.includes('compárteme tu nombre') ||
    t.includes('me regalas tu nombre') ||
    t.includes('como te llamas') ||
    t.includes('cómo te llamas') ||
    t.includes('tu nombre completo') ||
    (t.includes('confirmas') && t.includes('nombre')) ||
    t.includes('te registro como') ||
    t.includes('registrarte como')
  ) {
    return 'name';
  }
  if (t.includes('presupuesto') || t.includes('aproximado') || t.includes('cuanto') || t.includes('cuánto')) {
    return 'budget';
  }
  if (t.includes('zona') || t.includes('ubicacion') || t.includes('ubicación') || t.includes('colonia')) {
    return 'zone';
  }
  if (t.includes('visita') || t.includes('agendar')) {
    return 'visit';
  }
  if (
    t.includes('casa, departamento') ||
    t.includes('departamento o terreno') ||
    t.includes('tipo de inmueble') ||
    (t.includes('inmueble') && t.includes('casa'))
  ) {
    return 'property_type';
  }
  if (
    t.includes('habitada') ||
    t.includes('rentada') ||
    t.includes('libre') ||
    t.includes('ocupada') ||
    t.includes('ocupación') ||
    t.includes('ocupacion')
  ) {
    return 'occupancy';
  }
  if (
    t.includes('detalles, precio') ||
    t.includes('precio, ubicacion') ||
    t.includes('precio, ubicación') ||
    t.includes('disponibilidad o visita')
  ) {
    return 'property_menu';
  }
  if (
    t.includes('dime en una frase') ||
    t.includes('que necesitas') ||
    t.includes('qué necesitas') ||
    t.includes('en que te puedo ayudar') ||
    t.includes('en qué te puedo ayudar') ||
    t.includes('como te puedo ayudar') ||
    t.includes('cómo te puedo ayudar') ||
    t.includes('dime un poco mas') ||
    t.includes('dime un poco más')
  ) {
    return 'generic_help';
  }
  if (t.startsWith('hola') && (t.includes('te puedo ayudar') || t.includes('claro'))) {
    return 'greeting_help';
  }
  return 'other';
}

function classifyFallbackBucket(replyText = '') {
  const t = normalizeText(String(replyText || ''));
  if (!t) return 'empty';
  if (t.includes('te hago una pregunta rapida') || t.includes('te hago una pregunta rápida')) return 'price_avail_stub';
  if (t.includes('dime en una frase') || t.includes('que necesitas') || t.includes('qué necesitas')) return 'generic_help';
  if (t.includes('hola, claro') && t.includes('te puedo ayudar')) return 'greeting_help';
  if (t.includes('sigo con tu busqueda') || t.includes('sigo con tu búsqueda')) return 'demand_continue';
  if (t.includes('buscar casa en')) return 'demand_entry';
  if (t.includes('orientar con la venta')) return 'offer_entry';
  if (t.includes('dime un poco mas') || t.includes('dime un poco más')) return 'generic_tail';
  return 'other';
}

function isWeakOpeningBucket(bucket) {
  return bucket === 'generic_help' || bucket === 'generic_tail' || bucket === 'greeting_help';
}

function wasKindAskedRecently(aiState, kind) {
  if (!kind || kind === 'none' || kind === 'other') return false;
  const list = Array.isArray(aiState?.anti_loop_recent_question_types) ? aiState.anti_loop_recent_question_types : [];
  const tail = list.slice(-3);
  return tail.filter((x) => x === kind).length >= 2;
}

function wasSignatureRepeatedRecently(aiState, sig) {
  if (!sig || sig.length < 24) return false;
  const list = Array.isArray(aiState?.anti_loop_last_outbound_sigs) ? aiState.anti_loop_last_outbound_sigs : [];
  return list.slice(-2).includes(sig);
}

function isLikelyShortPersonNameToken(s = '') {
  const t = cleanSpaces(String(s || ''));
  if (!t || t.length < 2 || t.length > 48) return false;
  if (t.split(/\s+/).filter(Boolean).length > 5) return false;
  const low = normalizeText(t);
  if (/\b(busco|buscar|rento|rentar|compro|comprar|vendo|vender|quiero|casa|depa|depas|departamento|millones|pesos|mxn|usd|hola|buenas|informacion|información)\b/.test(low)) {
    return false;
  }
  return true;
}

/**
 * Limpia awaiting_field cuando el usuario ya contestó o muestra frustración por repetición.
 */
function buildStaleAwaitingFieldPatch(aiState = {}, parsedSignals = {}, inboundText = '', contact = null) {
  const patch = {};
  const waiting = aiState?.awaiting_field || null;
  if (!waiting) return patch;

  const text = cleanSpaces(String(inboundText || ''));
  const sig = parsedSignals && typeof parsedSignals === 'object' ? parsedSignals : {};

  let extractPossibleName = null;
  try {
    ({ extractPossibleName } = require('./parsers'));
  } catch {
    extractPossibleName = null;
  }

  if (waiting === 'full_name') {
    const fromSignals = cleanSpaces(String(sig.full_name || ''));
    const fromState = cleanSpaces(String(aiState.full_name || ''));
    const extracted = extractPossibleName ? extractPossibleName(text, aiState, sig.owner_relation) : null;
    const fromExtracted = cleanSpaces(String(extracted || ''));
    const contactName =
      contact &&
      String(contact.first_name || '')
        .trim()
        .toLowerCase() !== 'cliente' &&
      (String(contact.first_name || '').trim() || String(contact.last_name || '').trim());
    const safeSignalName = fromSignals && isLikelyShortPersonNameToken(fromSignals) ? fromSignals : '';
    const safeExtracted = fromExtracted && isLikelyShortPersonNameToken(fromExtracted) ? fromExtracted : '';
    const safeStateName = fromState && isLikelyShortPersonNameToken(fromState) ? fromState : '';

    if (safeSignalName || safeStateName || safeExtracted || contactName) {
      patch.awaiting_field = null;
      if (safeExtracted && !safeStateName) patch.full_name = safeExtracted;
      if (safeSignalName && !safeStateName && !patch.full_name) patch.full_name = safeSignalName;
    }
  }

  if (waiting === 'budget_max' && sig.budget_max != null && Number.isFinite(Number(sig.budget_max))) {
    patch.awaiting_field = null;
  }

  if (waiting === 'location_text' && cleanSpaces(String(sig.location_text || ''))) {
    patch.awaiting_field = null;
  }

  if (waiting === 'owner_relation' && sig.owner_relation != null && String(sig.owner_relation).trim()) {
    patch.awaiting_field = null;
  }

  if (waiting === 'property_type' && cleanSpaces(String(sig.property_type || aiState.property_type || ''))) {
    patch.awaiting_field = null;
  }

  if (
    waiting === 'occupancy_status' &&
    cleanSpaces(String(sig.occupancy_status || aiState.occupancy_status || ''))
  ) {
    patch.awaiting_field = null;
  }

  return patch;
}

function buildFrustrationRecoveryReply({
  aiState = {},
  contact = null,
  userText = '',
  hasValidHumanNameFn,
} = {}) {
  const hasName =
    typeof hasValidHumanNameFn === 'function' ? !!hasValidHumanNameFn(contact, aiState) : false;
  const loc = cleanSpaces(String(aiState?.location_text || ''));
  const flow = aiState?.lead_flow || null;
  const op = aiState?.operation_type || null;
  const nameBit = hasName
    ? ''
    : ' Si me dices cómo te llamo (solo tu nombre), te hablo más personal desde el siguiente mensaje.';

  const r0 = require('./r0ContextContinuity');
  const offerSafe = require('./offerSafeReply');
  const stickyOffer = r0.isR0StickySaleCaptureThread(aiState) || flow === 'offer';

  let retome = 'Retomo lo que comentaste.';
  const ut = normalizeText(userText || '');
  if (ut.includes('vender') || stickyOffer) {
    retome = 'Retomo el tema de venta de tu propiedad.';
  } else if (flow === 'demand' && loc) {
    retome = `Retomo tu búsqueda en ${loc}.`;
  } else if (flow === 'demand') {
    retome = 'Retomo que buscas propiedad.';
  }

  let oneQ = 'Para avanzar sin repetirme: ¿compras o rentas?';
  if (stickyOffer) {
    oneQ = 'Para avanzar sin repetirme: ¿en qué zona está la propiedad (colonia o municipio)?';
  } else if (flow === 'demand' && !loc) {
    oneQ = 'Para avanzar sin repetirme: ¿en qué zona o ciudad la quieres?';
  } else if (flow === 'demand' && loc && (aiState?.budget_max == null || !Number.isFinite(Number(aiState.budget_max)))) {
    oneQ = 'Para avanzar sin repetirme: ¿qué presupuesto máximo aproximado manejas (en MXN)?';
  }

  const out = `Tienes razón: pude haberme repetido, perdona. ${retome}${nameBit} ${oneQ}`.replace(/\s+/g, ' ').trim();
  return offerSafe.assertOfferSafeReply(out, aiState, userText).reply;
}

function applyFallbackStreakRecovery(reply, ctx = {}) {
  const { nextAiState = {}, text = '', contact = null, waProfileName = null } = ctx;
  const merged = mergeReplyText(reply);
  if (!merged) return { reply, patch: {} };

  const offerSafe = require('./offerSafeReply');
  const r0 = require('./r0ContextContinuity');

  const bucket = classifyFallbackBucket(merged);
  const prevBucket = nextAiState.anti_loop_last_fallback_bucket || null;
  let streak = Number(nextAiState.anti_loop_fallback_streak || 0) || 0;
  const inboundKind = classifyInboundShortIntent(text);
  const prevInbound = nextAiState.anti_loop_last_inbound_short_intent || null;

  if (bucket === 'empty' || bucket === 'other') {
    return { reply, patch: { anti_loop_last_inbound_short_intent: inboundKind } };
  }

  // Apertura: saludo / visita social no dispara “Perdona si se sintió repetido”
  if (
    inboundKind === 'greeting_hola' ||
    inboundKind === 'social_page_visit' ||
    inboundKind === 'intent_sale'
  ) {
    const safe = offerSafe.assertOfferSafeReply(merged, nextAiState, text);
    return {
      reply: safe.reply,
      patch: {
        anti_loop_last_fallback_bucket: bucket,
        anti_loop_fallback_streak: 1,
        anti_loop_last_inbound_short_intent: inboundKind,
        anti_loop_trigger: null,
      },
    };
  }

  if (prevBucket === bucket || (isWeakOpeningBucket(prevBucket) && isWeakOpeningBucket(bucket))) {
    const inboundChangedMeaningfully =
      prevInbound != null &&
      inboundKind !== prevInbound &&
      inboundKind !== 'empty' &&
      inboundKind !== 'ultra_short' &&
      inboundKind !== 'ack_short';
    if (inboundChangedMeaningfully) streak = 1;
    else streak += 1;
  } else streak = 1;

  const patch = {
    anti_loop_last_fallback_bucket: bucket,
    anti_loop_fallback_streak: streak,
    anti_loop_last_inbound_short_intent: inboundKind,
  };

  if (streak < 2) {
    const safe = offerSafe.assertOfferSafeReply(merged, nextAiState, text);
    return { reply: safe.reply, patch: { ...patch, anti_loop_trigger: safe.enforced ? safe.reason : null } };
  }

  // Hilo offer: nunca menú compra/renta
  if (r0.isR0StickySaleCaptureThread(nextAiState)) {
    const safe = offerSafe.assertOfferSafeReply(
      offerSafe.buildOfferSafeFallback(nextAiState, text),
      nextAiState,
      text,
    );
    return {
      reply: safe.reply,
      patch: { ...patch, anti_loop_fallback_streak: 0, anti_loop_trigger: 'offer_sticky_recovery' },
    };
  }

  if (nextAiState?.property_pauta_handoff_sent === true) {
    const { PROPERTY_PAUTA_HANDOFF_REPLY } = require('./propertyPautaHandoff');
    return {
      reply: PROPERTY_PAUTA_HANDOFF_REPLY,
      patch: { ...patch, anti_loop_fallback_streak: 0 },
    };
  }

  const loc = cleanSpaces(String(nextAiState.location_text || ''));
  const flow = nextAiState.lead_flow || null;
  const t = normalizeText(text || '');

  let body =
    'Perdona si se sintió repetido; sigo contigo. Para no dar vueltas, dime solo una de estas dos cosas: ¿buscas comprar o rentar, o quieres vender?';
  if (flow === 'offer' || t.includes('vender')) {
    body = `Entiendo. Sigo con tu venta${loc ? ` en ${loc}` : ''}. ¿En qué zona está la propiedad (solo colonia o municipio)?`;
  } else if (flow === 'demand' && loc) {
    body = `Sigo con tu búsqueda en ${loc}. ¿Es compra o renta, y qué presupuesto máximo aproximado manejas?`;
  } else if (flow === 'demand') {
    body = 'Sigo con tu búsqueda. Dime en una sola línea: zona aproximada y si es compra o renta.';
  }

  const tail =
    ' Si prefieres, también puedo dejar que un asesor humano te contacte con una aclaración puntual: solo dime “asesor”.';

  const wa = cleanSpaces(String(waProfileName || ''));
  const skipAsesorOffer = wa.length > 2;
  const outReply = skipAsesorOffer ? body : `${body}${tail}`;
  const safe = offerSafe.assertOfferSafeReply(outReply, nextAiState, text);

  return {
    reply: safe.reply,
    patch: {
      ...patch,
      anti_loop_fallback_streak: 0,
      anti_loop_last_inbound_short_intent: inboundKind,
      anti_loop_trigger: safe.enforced ? safe.reason : 'fallback_streak_recovery',
    },
  };
}

function reformulateNearDuplicate(original, kind, aiState = {}, userText = '') {
  const loc = cleanSpaces(String(aiState?.location_text || ''));
  const flow = aiState?.lead_flow || null;
  const offerSafe = require('./offerSafeReply');
  const r0 = require('./r0ContextContinuity');

  if (r0.isR0StickySaleCaptureThread(aiState)) {
    return offerSafe.buildOfferSafeFallback(aiState, userText);
  }

  let out;
  switch (kind) {
    case 'generic_help':
    case 'greeting_help':
      if (flow === 'demand' && loc) {
        out = `Sigo aquí. Retomo lo de ${loc}: ¿es compra o renta y qué presupuesto máximo aproximado?`;
        break;
      }
      if (flow === 'offer') {
        out = 'Sigo contigo con el tema de venta. Para ubicarlo: ¿en qué zona está la propiedad?';
        break;
      }
      out = 'Sigo contigo. Para avanzar sin repetirme: ¿buscas comprar, rentar o vender?';
      break;
    case 'name':
      if (flow === 'offer') {
        out = 'Ok, no lo preguntaré igual otra vez. Sigo con la venta de tu propiedad. ¿En qué colonia o municipio está?';
        break;
      }
      out = 'Ok, no lo preguntaré igual otra vez. Retomo: ¿compras/rentas o es tema de venta de tu propiedad?';
      break;
    case 'property_menu':
      out = loc
        ? `Sigo con ${loc}. Dime solo qué quieres ver primero: precio aproximado, ubicación en mapa o agendar visita.`
        : 'Sigo contigo. Dime solo una prioridad: precio, ubicación o visita.';
      break;
    default: {
      const raw = cleanSpaces(String(userText || ''));
      const t = normalizeText(raw);
      if (
        isLikelyShortPersonNameToken(raw) ||
        /^me llamo\b/i.test(raw) ||
        (t.startsWith('soy ') && raw.split(/\s+/).length <= 4)
      ) {
        const name = raw.replace(/^me llamo\s+/i, '').replace(/^soy\s+/i, '').trim();
        const cap = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
        if (flow === 'demand' && loc) {
          out = cap
            ? `Perfecto, ${cap}. Sigo con tu búsqueda en ${loc} — ¿quieres afinar recámaras o alguna amenidad?`
            : `Perfecto. Sigo con tu búsqueda en ${loc} — ¿quieres afinar recámaras o alguna amenidad?`;
          break;
        }
        if (flow === 'offer') {
          out = cap
            ? `Perfecto, ${cap}. Sigo con la venta de tu propiedad. ¿En qué colonia o municipio está?`
            : 'Perfecto. Sigo con la venta de tu propiedad. ¿En qué colonia o municipio está?';
          break;
        }
        out = cap
          ? `Perfecto, ${cap}. Para avanzar: ¿buscas comprar, rentar o es tema de venta?`
          : 'Perfecto. Para avanzar sin repetirme: ¿buscas comprar, rentar o vender una propiedad?';
        break;
      }
      if (flow === 'demand' && loc) {
        out = `Sigo con tu búsqueda en ${loc}. ¿Quieres afinar recámaras, zona o presupuesto?`;
        break;
      }
      out = `Entendido. ¿Quieres seguir con precio, ubicación o agendar una visita?`;
    }
  }
  return offerSafe.assertOfferSafeReply(out, aiState, userText).reply;
}

/**
 * Evita enviar el mismo bloque dos veces seguidas o repetir el mismo “tipo” de pregunta genérica.
 */
function applyOutboundNearDuplicateGuard(reply, ctx = {}) {
  const { recentOutboundTexts = [], userInboundText = '', nextAiState = {} } = ctx;
  const merged = mergeReplyText(reply);
  if (!merged) return { reply, patch: {} };

  const sig = normalizeOutboundSignature(merged);
  const kind = classifyOutboundQuestionKind(merged);

  const patch = {};

  if (wasSignatureRepeatedRecently(nextAiState, sig)) {
    return {
      reply: reformulateNearDuplicate(merged, kind, nextAiState, userInboundText),
      patch,
    };
  }

  if ((kind === 'generic_help' || kind === 'greeting_help') && wasKindAskedRecently(nextAiState, kind)) {
    return {
      reply: reformulateNearDuplicate(merged, kind, nextAiState, userInboundText),
      patch,
    };
  }

  const tail = Array.isArray(recentOutboundTexts) ? recentOutboundTexts.filter(Boolean).slice(-2) : [];
  for (const prev of tail) {
    const ps = normalizeOutboundSignature(prev);
    if (ps && sig === ps && sig.length > 20) {
      return {
        reply: reformulateNearDuplicate(merged, kind, nextAiState, userInboundText),
        patch,
      };
    }
  }

  return { reply, patch: {} };
}

function recordTurnAntiLoopMeta(nextAiState, reply, responseSource = '') {
  if (!nextAiState || typeof nextAiState !== 'object') return;
  const merged = mergeReplyText(reply);
  if (!merged) return;

  const kind = classifyOutboundQuestionKind(merged);
  const sig = normalizeOutboundSignature(merged);

  const types = Array.isArray(nextAiState.anti_loop_recent_question_types)
    ? [...nextAiState.anti_loop_recent_question_types]
    : [];
  types.push(kind);
  nextAiState.anti_loop_recent_question_types = types.slice(-8);

  const sigs = Array.isArray(nextAiState.anti_loop_last_outbound_sigs) ? [...nextAiState.anti_loop_last_outbound_sigs] : [];
  if (sig) {
    sigs.push(sig);
    nextAiState.anti_loop_last_outbound_sigs = sigs.slice(-6);
  }

  if (responseSource === 'fallback_consultive' || responseSource === 'engine_v2_safe_fallback') {
    nextAiState.anti_loop_last_fallback_bucket = classifyFallbackBucket(merged);
  }
}

module.exports = {
  detectConversationalFrustration,
  classifyInboundShortIntent,
  isLikelyShortPersonNameToken,
  normalizeOutboundSignature,
  classifyOutboundQuestionKind,
  classifyFallbackBucket,
  buildStaleAwaitingFieldPatch,
  buildFrustrationRecoveryReply,
  applyFallbackStreakRecovery,
  applyOutboundNearDuplicateGuard,
  recordTurnAntiLoopMeta,
  mergeReplyText,
};
