'use strict';

const { normalizeText } = require('../../../utils/text');
const { CONVERSATION_GOALS, CONVERSATION_STAGES } = require('../types/constants');
const { isStickyContextActive } = require('../ownership/stickyContext');

/** Menú global vender / comprar / rentar (reinicio de flujo). */
const GLOBAL_INTENT_MENU_RE =
  /¿\s*buscas\s+vender|vender,\s*poner\s+en\s+renta,\s*comprar\s+o\s+rentar|vender,\s*comprar\s+o\s+rentar/i;

const GLOBAL_OPENING_VARIANTS = Object.freeze([
  'Hola, soy el asesor IA de Luxetty. Con gusto te ayudo. ¿Buscas vender, poner en renta, comprar o rentar una propiedad?',
  'Hola, qué gusto saludarte. Soy el asesor IA de Luxetty. Cuéntame si buscas vender, rentar, comprar o publicar una propiedad.',
  'Hola, con gusto te atiendo desde Luxetty. ¿Qué te gustaría hacer: vender, poner en renta, comprar o rentar?',
  'Buen día. Soy el asesor IA de Luxetty. ¿Te apoyo con venta, renta, compra o búsqueda de departamento/casa?',
  'Hola. Estoy para ayudarte con inmuebles en Luxetty. ¿Buscas vender, comprar o rentar?',
]);

const SOCIAL_RAPPORT_VARIANTS = Object.freeze([
  'Muy bien, gracias. Cuéntame cuando quieras qué tipo de propiedad te interesa y te ayudo paso a paso.',
  'Todo bien por acá, gracias. Cuando gustes dime si buscas rentar, comprar o vender y lo vemos con calma.',
  'Qué gusto. Aquí estoy para ayudarte con lo inmobiliario que necesites cuando quieras contarme.',
  'Gracias, igualmente. Dime en qué te puedo orientar con propiedades y seguimos desde ahí.',
]);

/**
 * @param {string} text
 */
function replySignature(text) {
  return normalizeText(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 */
function isGlobalIntentMenu(text) {
  return GLOBAL_INTENT_MENU_RE.test(String(text || ''));
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function hasStickyRentDemand(state) {
  return (
    state.leadFlow === 'demand' &&
    state.operationType === 'rent' &&
    state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY
  );
}

/**
 * Sticky mínimo M1: con renta demanda activa no reabrir menú global.
 * @param {import('../types/conversationState').ConversationState} state
 */
function shouldSuppressGlobalIntentMenu(state) {
  if (hasStickyRentDemand(state)) return true;
  if (isStickyContextActive(state)) return true;
  if (state.conversationGoalLocked === true && state.leadFlow) return true;
  return false;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string[]} candidates
 */
function pickOpeningVariant(state, candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return '';
  const lastSig =
    state.lastAssistantReplySignature || replySignature(state.lastAssistantReply || '');
  const pool = lastSig ? list.filter((c) => replySignature(c) !== lastSig) : list;
  const usable = pool.length ? pool : list;
  const seed = String(state.conversationId || state.phone || 'v3');
  const turnBias = replySignature(state.lastUserText || '').length;
  let hash = 0;
  const key = `${seed}|${lastSig}|${turnBias}|${usable.length}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return usable[hash % usable.length];
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function getBuyDemandContinuityVariants(state) {
  const zone = state.locationText ? ` en ${state.locationText}` : '';
  const budget = state.budget != null ? ' con tu presupuesto' : '';
  const variants = [
    `Seguimos con tu búsqueda de compra${zone}${budget}. ¿Quieres afinar zona, presupuesto, recámaras o algún detalle (patio, etc.)?`,
    'Perfecto, sigo contigo en la compra. Cuéntame qué criterio quieres ajustar sin reiniciar.',
    'Tomé el contexto de tu búsqueda. ¿Afinamos zona, presupuesto o tamaño de la propiedad?',
    'De acuerdo, continuamos con opciones de compra. ¿Qué dato quieres precisar ahora?',
    'Gracias por el mensaje. Sigo con tu compra: dime si movemos zona, presupuesto o algún detalle.',
    'Entendido. Mantengo tu búsqueda activa; ¿qué quieres afinar ahora?',
    'Listo, aquí sigo. ¿Ajustamos presupuesto, zona o recámaras?',
    'Perfecto. Cuando quieras, dime el siguiente criterio y lo incorporo a la búsqueda.',
    'De acuerdo. ¿Seguimos con el mismo presupuesto o quieres cambiar algo más?',
    'Gracias. Para no repetirte, dime el dato que quieres mover (zona, precio o tamaño).',
  ];
  if (!state.collectedFields?.fullName) {
    variants.unshift('Para seguir con opciones de compra, ¿me compartes tu nombre?');
  }
  if (state.locationText && state.budget == null) {
    variants.unshift(`Gracias. Para ${state.locationText}, ¿qué presupuesto aproximado manejas?`);
  }
  if (state.budget != null && !state.locationText) {
    variants.unshift('¿En qué zona te gustaría enfocar la búsqueda con ese presupuesto?');
  }
  return variants;
}

function getSellOfferContinuityVariants(state) {
  const zone = state.locationText ? ` en ${state.locationText}` : '';
  const variants = [
    `Seguimos con la captación de tu propiedad${zone}. ¿Qué dato quieres completar (precio, ocupación o tipo)?`,
    'Perfecto, continúo contigo en la venta. Dime el siguiente dato de tu inmueble.',
    'Tomé el contexto de tu propiedad. ¿Afinamos precio esperado, ocupación o algún detalle?',
    'De acuerdo, vamos con la venta. ¿Qué información te falta registrar?',
  ];
  if (!state.collectedFields?.fullName) {
    variants.unshift('Para seguir con la captación, ¿me compartes tu nombre?');
  }
  if (state.locationText && !sellOfferPriceSatisfied(state)) {
    variants.unshift(
      `Gracias por la zona (${state.locationText}). Si no tienes precio fijo, podemos orientarte con valuación; ¿cómo está la ocupación?`,
    );
  }
  return variants;
}

function getRentOfferContinuityVariants(state) {
  const zone = state.locationText ? ` en ${state.locationText}` : '';
  const variants = [
    `Seguimos con poner tu propiedad en renta${zone}. ¿Qué dato quieres completar (renta esperada, ocupación)?`,
    'Perfecto, continúo contigo en la captación para renta. Dime el siguiente dato.',
    'Tomé que quieres rentar tu propiedad. ¿Afinamos ocupación o renta esperada?',
    'De acuerdo, vamos con la renta de tu inmueble. ¿Qué te gustaría precisar ahora?',
  ];
  if (!state.collectedFields?.fullName) {
    variants.unshift('Para seguir con la renta de tu propiedad, ¿me compartes tu nombre?');
  }
  return variants;
}

function sellOfferPriceSatisfied(state) {
  if (state.expectedPrice != null) return true;
  if (state.valuationRequested === true || state.priceUnknown === true) return true;
  if (state.collectedFields?.valuationRequested === true) return true;
  return false;
}

function getRentDemandContinuityVariants(state) {
  const zone = state.locationText ? ` en ${state.locationText}` : '';
  const variants = [
    'Perfecto, seguimos con tu búsqueda de renta. Cuéntame qué dato quieres afinar (zona, presupuesto o recámaras).',
    `Tomé que buscas renta${zone}. ¿Qué presupuesto mensual manejas aproximadamente?`,
    'De acuerdo, vamos con la renta. ¿En qué zona te gustaría enfocar la búsqueda?',
    'Gracias por el dato. Sigo contigo en la renta: ¿qué presupuesto aproximado tienes en mente?',
    'Entendido. Para afinar opciones de renta, ¿me compartes zona o presupuesto que manejas?',
  ];
  if (!state.collectedFields?.fullName) {
    variants.unshift(
      'Perfecto, te ayudo con la renta. Para orientarte mejor, ¿me compartes tu nombre?',
      'Claro, vamos con departamento o casa en renta. ¿Me dices tu nombre para continuar?',
    );
  }
  if (state.locationText && state.budget == null) {
    variants.unshift(`Gracias. Para ${state.locationText}, ¿qué presupuesto mensual manejas?`);
  }
  return variants;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function resolveContinuityVariants(state) {
  if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    return getBuyDemandContinuityVariants(state);
  }
  if (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
    return getSellOfferContinuityVariants(state);
  }
  if (state.conversationGoal === CONVERSATION_GOALS.RENT_OUT_PROPERTY) {
    return getRentOfferContinuityVariants(state);
  }
  if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY) {
    const code = state.propertyListingCode ? ` ${state.propertyListingCode}` : '';
    const variants = [
      `Sigo con tu interés en${code || ' la propiedad'}. Puedo orientarte con lo publicado sin inventar datos.`,
      `Continuamos con${code || ' tu consulta'}. ¿Prefieres precio, zona o enlace de la ficha?`,
    ];
    if (!state.collectedFields?.fullName) {
      variants.unshift(`Para${code ? ` la referencia${code},` : ''} ¿me compartes tu nombre?`);
    }
    return variants;
  }
  return getRentDemandContinuityVariants(state);
}

function composeGenericUnderstandingPrompt(state) {
  if (shouldSuppressGlobalIntentMenu(state)) {
    const continuityVariants = resolveContinuityVariants(state);
    const text = pickOpeningVariant(state, continuityVariants);
    return {
      responseText: text,
      followUpQuestion: null,
      awaitingField: state.awaitingField,
      toneFlags: { consultive: true, continuity: true },
    };
  }
  const text = pickOpeningVariant(state, [...GLOBAL_OPENING_VARIANTS]);
  return {
    responseText: text,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true, advisorPersona: true },
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeSocialRapportReply(state) {
  const text = pickOpeningVariant(state, [...SOCIAL_RAPPORT_VARIANTS]);
  return {
    responseText: text,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true, socialRapport: true },
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeRentDemandKickoff(state) {
  const variants = [
    'Perfecto, te ayudo con la renta. ¿En qué zona te gustaría buscar?',
    'Claro, buscas renta. ¿Me compartes la zona que tienes en mente?',
    'De acuerdo, vamos con la renta. Para empezar, ¿qué zona te interesa?',
  ];
  if (!state.collectedFields?.fullName) {
    variants.unshift('Perfecto, te ayudo con la renta. ¿Me compartes tu nombre y la zona que buscas?');
  }
  return {
    responseText: pickOpeningVariant(state, variants),
    followUpQuestion: null,
    awaitingField: state.collectedFields?.fullName ? 'location_text' : 'full_name',
    toneFlags: { consultive: true },
  };
}

/**
 * Anti-repetición general post-composer.
 * @param {{ state: import('../types/conversationState').ConversationState, replyText: string }} input
 */
function shouldApplyAntiRepetition(state) {
  if (isStickyContextActive(state)) return true;
  if (state.conversationGoalLocked === true) return true;
  if (state.leadFlow) return true;
  return false;
}

function applyGeneralReplyAntiRepetition(input) {
  const state = input.state || {};
  const replyText = String(input.replyText || '');
  if (!shouldApplyAntiRepetition(state)) {
    return { text: replyText, replaced: false };
  }
  const sig = replySignature(replyText);
  const lastSig =
    state.lastAssistantReplySignature || replySignature(state.lastAssistantReply || '');
  if (!lastSig || sig !== lastSig) {
    return { text: replyText, replaced: false };
  }

  let candidates = [];
  if (shouldSuppressGlobalIntentMenu(state)) {
    candidates = resolveContinuityVariants(state);
  } else if (isGlobalIntentMenu(replyText)) {
    candidates = [...GLOBAL_OPENING_VARIANTS];
  } else {
    return { text: replyText, replaced: false };
  }

  const picked = pickOpeningVariant(state, candidates);
  if (!picked || replySignature(picked) === lastSig) {
    return { text: replyText, replaced: false };
  }
  return { text: picked, replaced: true };
}

/**
 * @param {string} text
 */
function isSocialRapportMessage(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (/\b(hola|buenas|hey)\b/.test(t) && t.length < 12) return false;
  return (
    /\b(todo bien|muy bien|gracias|igualmente)\b/.test(t) ||
    /\b(y tu|y tú|como estas|cómo estás)\b/.test(t)
  );
}

module.exports = {
  replySignature,
  isGlobalIntentMenu,
  isSocialRapportMessage,
  hasStickyRentDemand,
  shouldSuppressGlobalIntentMenu,
  shouldApplyAntiRepetition,
  pickOpeningVariant,
  composeGenericUnderstandingPrompt,
  getBuyDemandContinuityVariants,
  getSellOfferContinuityVariants,
  getRentOfferContinuityVariants,
  getRentDemandContinuityVariants,
  resolveContinuityVariants,
  composeSocialRapportReply,
  composeRentDemandKickoff,
  applyGeneralReplyAntiRepetition,
  GLOBAL_OPENING_VARIANTS,
};
