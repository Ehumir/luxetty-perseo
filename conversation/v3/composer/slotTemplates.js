'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');
const { CONVERSATION_GOALS, V3_INTENT } = require('../types/constants');
const { occupancyStatusLabel } = require('../interpreter/occupancyParser');

function formatMoneyMx(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('es-MX')}`;
  }
}

function firstName(state) {
  const full = cleanSpaces(String(state.collectedFields?.fullName || ''));
  if (!full) return null;
  return full.split(/\s+/)[0];
}

function propertyTypeLabel(state) {
  const t = state.propertyType || state.collectedFields?.propertyType;
  if (t === 'house') return 'casa';
  if (t === 'apartment') return 'departamento';
  if (t === 'land') return 'terreno';
  return 'inmueble';
}

function composeAdvisorGreeting(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const headline = cleanSpaces(String(st.campaignHeadline || '')).slice(0, 140);
  const code = cleanSpaces(String(st.propertyListingCode || ''));

  if (st.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY && st.conversationGoalLocked) {
    return {
      responseText:
        'Hola de nuevo. Seguimos con el tema de la venta de tu inmueble. ¿En qué te apoyo ahora con la siguiente información?',
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true, advisorPersona: true },
    };
  }

  if (st.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY && st.conversationGoalLocked) {
    return {
      responseText:
        'Hola de nuevo. Seguimos con lo que buscas en renta. Cuéntame qué dato quieres afinar (zona, presupuesto o recámaras).',
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true, advisorPersona: true },
    };
  }

  if (st.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY && code) {
    return {
      responseText: `Hola. Seguimos con tu interés en la referencia ${code}. ¿Prefieres que revisemos precio, disponibilidad o que un asesor te confirme datos en este mismo canal?`,
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true, advisorPersona: true },
    };
  }

  if (headline) {
    return {
      responseText: `Hola, soy el asesor IA de Luxetty. Vi que escribiste en relación con: «${headline}». Para no asumir de más: ¿buscas una propiedad en específico, quieres vender o publicar la tuya, o prefieres que un asesor te oriente?`,
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true, advisorPersona: true },
    };
  }

  return {
    responseText:
      'Hola, soy el asesor IA de Luxetty. Con gusto te ayudo. ¿Buscas vender, poner en renta, comprar o rentar una propiedad?',
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true, advisorPersona: true },
  };
}

function composeCampaignGenericTouch(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const headline = cleanSpaces(String(st.campaignHeadline || '')).slice(0, 160);
  if (headline) {
    return {
      responseText: `Gracias por tu mensaje. Con el contexto de la pauta («${headline}»), cuéntame en breve qué necesitas: si buscas una propiedad por código, si quieres vender o publicar la tuya, o si prefieres hablar con un asesor.`,
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true },
    };
  }
  return {
    responseText:
      'Gracias por escribir. Para orientarte sin inventar datos: ¿buscas una propiedad por código, quieres vender o rentar la tuya, o prefieres que un asesor te guíe?',
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true },
  };
}

function composeHandoffPropertyOrCode(state) {
  const nm = firstName(state) || 'perfecto';
  const code = cleanSpaces(String(state.propertyListingCode || ''));
  const tail = code ? ` la referencia ${code}` : ' lo que comentas';
  const zone = state.locationText ? ` en ${state.locationText}` : '';
  return {
    responseText: `Perfecto, ${nm}. Para${tail}${zone}, un asesor de Luxetty puede confirmarte precio y disponibilidad reales (sin inventar datos). ¿Te parece si te contactan por aquí?`,
    followUpQuestion: null,
    awaitingField: 'advisor_contact_consent',
    toneFlags: { consultive: true, handoff: true },
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} slotId
 */
function composeSlotQuestion(state, slotId) {
  const nm = firstName(state);
  const zone = state.locationText || 'esa zona';

  switch (slotId) {
    case 'intent':
      return composeAdvisorGreeting(state);
    case 'full_name':
      if (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
        return {
          responseText: 'Claro, te apoyo con la venta. Para orientarte mejor, ¿me compartes tu nombre?',
          followUpQuestion: null,
          awaitingField: 'full_name',
          toneFlags: { consultive: true },
        };
      }
      if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY) {
        const code = cleanSpaces(String(state.propertyListingCode || ''));
        const chNote =
          state.channelPreference === 'whatsapp'
            ? ' Anoté que prefieres WhatsApp para el seguimiento.'
            : '';
        return {
          responseText: code
            ? `Perfecto. Para la referencia ${code}, ¿me compartes tu nombre?${chNote}`
            : `Con gusto. Para continuar, ¿me compartes tu nombre?${chNote}`,
          followUpQuestion: null,
          awaitingField: 'full_name',
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: 'Con gusto. Para continuar, ¿me compartes tu nombre?',
        followUpQuestion: null,
        awaitingField: 'full_name',
        toneFlags: { consultive: true },
      };
    case 'location_text':
      return {
        responseText: nm
          ? `Perfecto, ${nm}. ¿En qué zona está la propiedad?`
          : '¿En qué zona está la propiedad?',
        followUpQuestion: null,
        awaitingField: 'location_text',
        toneFlags: { consultive: true },
      };
    case 'expected_price':
      return {
        responseText: nm
          ? `Perfecto, ${nm}. Tomé la zona (${zone}). ¿Qué precio esperado manejas?`
          : `Tomé la zona (${zone}). ¿Qué precio esperado manejas?`,
        followUpQuestion: null,
        awaitingField: 'expected_price',
        toneFlags: { consultive: true },
      };
    case 'budget':
      return {
        responseText: nm
          ? `Perfecto, ${nm}. En ${zone}, ¿qué presupuesto aproximado manejas?`
          : `En ${zone}, ¿qué presupuesto aproximado manejas?`,
        followUpQuestion: null,
        awaitingField: 'budget',
        toneFlags: { consultive: true },
      };
    case 'property_type':
      return {
        responseText: nm
          ? `Entendido, ${nm}. ¿Es casa, departamento o terreno?`
          : '¿Es casa, departamento o terreno?',
        followUpQuestion: null,
        awaitingField: 'property_type',
        toneFlags: { consultive: true },
      };
    case 'occupancy_status': {
      const tipo = propertyTypeLabel(state);
      const pres = formatMoneyMx(state.expectedPrice);
      return {
        responseText: `Perfecto, ${nm}. Tengo tu ${tipo} en ${zone} con precio esperado de ${pres}. ¿Está habitada, rentada o libre?`,
        followUpQuestion: null,
        awaitingField: 'occupancy_status',
        toneFlags: { consultive: true },
      };
    }
    default:
      return {
        responseText: 'Te escucho. ¿Me cuentas un poco más para orientarte mejor?',
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
  }
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeHandoffOffer(state) {
  const nm = firstName(state) || 'perfecto';
  const zone = state.locationText || 'esa zona';
  const pres = state.expectedPrice != null ? formatMoneyMx(state.expectedPrice) : null;
  const rangeHint = pres ? `Por la zona y el rango (${pres}) que me comentas, sí vale la pena revisarla bien.` : `Por lo que me comentas de ${zone}, sí vale la pena revisarla bien.`;

  return {
    responseText: `Perfecto, ${nm}. ${rangeHint} Si te parece, puedo pedirle a uno de nuestros asesores de Luxetty que te contacte para ayudarte con una valuación más precisa.`,
    followUpQuestion: null,
    awaitingField: 'advisor_contact_consent',
    toneFlags: { consultive: true, handoff: true },
  };
}

function composeConsentAccepted(state) {
  const nm = firstName(state) || 'perfecto';
  return {
    responseText: `Listo, ${nm}. Ya dejé anotado que un asesor de Luxetty te contacte para seguir contigo. En breve te escriben por este mismo canal.`,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true, handoff: true },
  };
}

function composeConsentDeclined(state) {
  const nm = firstName(state) || 'perfecto';
  return {
    responseText: `Entendido, ${nm}. Sin problema. Si más adelante quieres que un asesor te apoye, me avisas y lo coordinamos.`,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true },
  };
}

function getActivePropertyFacts(state) {
  const ap = state.activeProperty && typeof state.activeProperty === 'object' ? state.activeProperty : {};
  return {
    title: ap.title || null,
    priceLabel: ap.price_label || ap.priceLabel || null,
    priceAmount: ap.price != null && Number.isFinite(Number(ap.price)) ? Number(ap.price) : null,
    publicUrl: ap.public_url || ap.publicUrl || null,
    locationLabel: ap.location_label || ap.locationLabel || ap.zone || state.locationText || null,
    status: ap.status || null,
    isActive: ap.is_active,
    isPublished: ap.is_published,
    bedrooms: ap.bedrooms != null ? Number(ap.bedrooms) : null,
    constructionM2: ap.construction_m2 != null ? Number(ap.construction_m2) : null,
    currency: ap.currency || 'MXN',
  };
}

function composePropertyQaEntry(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const nm = firstName(st) || 'perfecto';
  const code = cleanSpaces(String(st.propertyListingCode || ''));
  const ref = code ? `la referencia ${code}` : 'esta publicación';
  return {
    responseText: `Gracias, ${nm}. Sobre ${ref}, puedo orientarte con lo publicado (precio, zona o enlace) sin inventar datos. ¿Qué te gustaría revisar primero?`,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true },
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} family
 */
function composePropertyFactReply(state, family) {
  const st = state && typeof state === 'object' ? state : {};
  const nm = firstName(st);
  const code = cleanSpaces(String(st.propertyListingCode || ''));
  const ref = code ? `la ${code}` : 'esta propiedad';
  const f = getActivePropertyFacts(st);
  const greet = nm ? `${nm}, ` : '';

  switch (family) {
    case 'price': {
      if (f.priceLabel) {
        return {
          responseText: `${greet}Por lo publicado de ${ref}, el precio listado es ${f.priceLabel}. Eso es lo que aparece en anuncio; cualquier negociación ya es con operación vigente.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      if (f.priceAmount != null) {
        const pl = formatMoneyMx(f.priceAmount);
        return {
          responseText: `${greet}Por lo publicado de ${ref}, el precio listado es ${pl}. Lo tomo del anuncio; negociación o vigencia fina conviene confirmarla con operación.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      const tail = f.publicUrl
        ? `Puedes revisar la ficha aquí: ${f.publicUrl}.`
        : 'Con el código debería abrirse en la vitrina; si no carga, dime y revisamos zona o fotos.';
      return {
        responseText: `${greet}Todavía no veo el precio publicado enlazado a ${ref} en mi contexto por este canal. ${tail}`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    }
    case 'location': {
      if (f.locationLabel) {
        return {
          responseText: `${greet}En lo publicado de ${ref}, la ubicación aproximada es ${f.locationLabel}. Dirección exacta casi nunca va completa en anuncio; si necesitas micro-zona, dímelo y vemos qué más aparece en la ficha.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      const tail = f.publicUrl
        ? `En la ficha (${f.publicUrl}) casi siempre viene colonia o zona aproximada.`
        : 'En la ficha pública casi siempre viene colonia o zona aproximada con el código.';
      return {
        responseText: `${greet}No tengo aún la zona enlazada a ${ref} en este hilo. ${tail}`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    }
    case 'availability': {
      if (f.isActive === false || f.isPublished === false) {
        return {
          responseText: `${greet}Por lo que veo enlazado a ${ref}, el anuncio podría no estar activo o visible; conviene validar en la ficha pública si sigue publicada.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      if (f.isActive === true || f.status) {
        const stLabel = f.status ? String(f.status) : 'activa en vitrina';
        return {
          responseText: `${greet}Según lo publicado de ${ref}, aparece como ${stLabel}. Eso no sustituye confirmación operativa el mismo día, pero sí orienta si sigue en circulación pública.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: `${greet}Disponibilidad fina cambia rápido: lo honesto es revisar la ficha pública de ${ref} y, si quieres, después vemos el siguiente paso con calma.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    }
    case 'credit':
      return {
        responseText: `${greet}Crédito/hipoteca depende de perfil bancario y de cómo esté publicada la operación de ${ref}. Lo público casi nunca especifica “acepta crédito” al 100 %; en la ficha a veces viene una pista, y el cierre fino ya es con quien opera.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    case 'link':
      if (f.publicUrl) {
        return {
          responseText: `${greet}Aquí tienes el enlace público de ${ref}: ${f.publicUrl}`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: `${greet}Aún no tengo el enlace resuelto a ${ref} en este hilo; con el código debería abrirse en la vitrina. Si pegas aquí lo que ves en el buscador, lo alineamos.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    case 'photos':
      return {
        responseText: `${greet}Las fotos suelen ir en la galería de la ficha pública de ${ref}. ${f.publicUrl ? `Puedes verlas aquí: ${f.publicUrl}` : 'Cuando tenga el enlace te lo paso; mientras, si me describes qué buscas (recámaras, niveles, estado), te oriento con lo publicado.'}`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    case 'layout': {
      const bits = [];
      if (f.bedrooms != null) bits.push(`${f.bedrooms} recámaras`);
      if (f.constructionM2 != null) bits.push(`${f.constructionM2} m² construcción`);
      if (bits.length) {
        return {
          responseText: `${greet}En lo publicado de ${ref}: ${bits.join(', ')}. Si te falta un dato (baños, niveles, patio), dime y lo buscamos en la misma ficha.`,
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: `${greet}Plano y distribución casi siempre vienen en la ficha pública de ${ref}. ${f.publicUrl ? `Revisa aquí: ${f.publicUrl}` : 'Si me dices qué recámara o m² buscas, afinamos con lo publicado.'}`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    }
    case 'info':
      return {
        responseText: `${greet}${f.title ? `La ficha la tengo como «${f.title}». ` : ''}Con ${ref} puedo ir campo por campo (precio, zona, m², recámaras, enlace). ¿Por cuál quieres que empecemos?`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    case 'interest':
      return {
        responseText: `${greet}Se nota el interés en ${ref}. Para no asumir: dime si primero quieres aterrizar precio, ubicación aproximada o ver la ficha pública, y lo vemos en ese orden.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    default:
      return {
        responseText: `${greet}Te leo. Sobre ${ref}, dime si lo que buscas es precio, zona, disponibilidad, fotos, enlace o tema de crédito, y te respondo con lo publicado.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
  }
}

function composePropertyQaNeutralContinue(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const nm = firstName(st);
  const code = cleanSpaces(String(st.propertyListingCode || ''));
  const tail = code ? `con la ${code}` : 'con esta propiedad';
  const prefix = nm ? `Va, ${nm}. ` : '';
  return {
    responseText: `${prefix}Para seguir ${tail}: cuéntame si buscas precio, zona, si sigue publicada, crédito o el enlace.`,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true },
  };
}

function fingerprintCommercialReply(text, state) {
  let s = normalizeText(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim();
  const nm = firstName(state);
  if (nm) {
    const nt = normalizeText(nm);
    s = s.split(nt).join('NAME');
  }
  return s.replace(/\d{4,}/g, 'NUM');
}

function isCommercialHandoffReply(text) {
  return /\b(asesor|contacten|te\s+contact|me\s+pueden\s+contactar)\b/i.test(String(text || ''));
}

function composePropertyLoopBreak(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const nm = firstName(st) || 'perfecto';
  const code = cleanSpaces(String(st.propertyListingCode || ''));
  const ref = code ? `la referencia ${code}` : 'esta propiedad';
  return `Gracias por la paciencia, ${nm}. Prefiero no repetir el mismo cierre: dime qué te falta concreto de ${ref} (precio publicado, zona o enlace) y lo vemos con lo que sí pueda compartir por aquí.`;
}

/**
 * Anti-loop semántico para CTAs de handoff repetidos (F3.3A).
 * @param {{ state: import('../types/conversationState').ConversationState, replyText: string, handoffOut: { action: string } }} input
 */
function applyPropertyReplyAntiLoop(input) {
  const state = input.state || {};
  const text = String(input.replyText || '');
  const handoffOut = input.handoffOut || {};
  if (!isCommercialHandoffReply(text)) return { text, replaced: false };
  const prev = String(state.lastAssistantReply || '');
  if (!prev || !isCommercialHandoffReply(prev)) return { text, replaced: false };
  const fp = fingerprintCommercialReply(text, state);
  const prevFp = fingerprintCommercialReply(prev, state);
  if (
    fp &&
    fp === prevFp &&
    (handoffOut.action === 'OFFER_HANDOFF' || state.lastOfferType === 'HANDOFF_PROPERTY')
  ) {
    return { text: composePropertyLoopBreak(state), replaced: true };
  }
  return { text, replaced: false };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<import('../planner/qualificationPlanner').evaluateQualification>} plannerOut
 * @param {{ action: string }} handoffOut
 */
function composeFromPlannerContext(state, decision, plannerOut, handoffOut) {
  const intent = decision.detectedIntent;

  if (intent === V3_INTENT.CAMPAIGN_GENERIC_TOUCH) return composeCampaignGenericTouch(state);

  if (handoffOut.action === 'CONSENT_ACCEPTED' || handoffOut.action === 'HANDOFF_COMPLETE') {
    return composeConsentAccepted(state);
  }
  if (handoffOut.action === 'CONSENT_DECLINED') return composeConsentDeclined(state);

  if (handoffOut.action === 'PROPERTY_QA_ENTRY') {
    return composePropertyQaEntry(state);
  }
  if (handoffOut.action === 'PROPERTY_QA_CONTINUE') {
    if (intent === V3_INTENT.PROPERTY_FACT_QUESTION) {
      const fam = decision.propertyInquiryFamily || 'generic';
      return composePropertyFactReply(state, fam);
    }
    return composePropertyQaNeutralContinue(state);
  }

  if (handoffOut.action === 'OFFER_HANDOFF') {
    if (
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY ||
      (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY && state.propertyListingCode)
    ) {
      return composeHandoffPropertyOrCode(state);
    }
    return composeHandoffOffer(state);
  }

  if (intent === V3_INTENT.GREETING) return composeAdvisorGreeting(state);

  if (intent === V3_INTENT.SELL_PROPERTY) {
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    return composeSlotQuestion(state, 'location_text');
  }

  if (intent === V3_INTENT.PROPERTY_INQUIRY) {
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    if (plannerOut.nextSlot) return composeSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.RENT_OUT_PROPERTY) {
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    return composeSlotQuestion(state, 'location_text');
  }

  if (intent === V3_INTENT.IDENTITY_CAPTURE && plannerOut.nextSlot) {
    return composeSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.LOCATION_CAPTURE && plannerOut.nextSlot) {
    return composeSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.SELLER_PRICE && plannerOut.nextSlot) {
    return composeSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.PROPERTY_TYPE_CAPTURE && plannerOut.nextSlot) {
    return composeSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.OCCUPANCY_CAPTURE && handoffOut.action === 'OFFER_HANDOFF') {
    return composeHandoffOffer(state);
  }

  if (plannerOut.nextSlot) return composeSlotQuestion(state, plannerOut.nextSlot);

  if (plannerOut.qualificationComplete && handoffOut.action === 'OFFER_HANDOFF') {
    if (
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY ||
      (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY && state.propertyListingCode)
    ) {
      return composeHandoffPropertyOrCode(state);
    }
    return composeHandoffOffer(state);
  }

  return {
    responseText: 'Te escucho. ¿Me cuentas si buscas vender, poner en renta, comprar o rentar?',
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true },
  };
}

module.exports = {
  composeAdvisorGreeting,
  composeCampaignGenericTouch,
  composeHandoffPropertyOrCode,
  composeSlotQuestion,
  composeHandoffOffer,
  composeConsentAccepted,
  composeConsentDeclined,
  composeFromPlannerContext,
  composePropertyQaEntry,
  composePropertyFactReply,
  composePropertyQaNeutralContinue,
  applyPropertyReplyAntiLoop,
  formatMoneyMx,
  firstName,
};
