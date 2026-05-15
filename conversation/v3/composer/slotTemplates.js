'use strict';

const { cleanSpaces } = require('../../../utils/text');
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
          responseText: 'Claro, te apoyo con la venta. Para orientarte mejor, ¿cómo te llamas?',
          followUpQuestion: null,
          awaitingField: 'full_name',
          toneFlags: { consultive: true },
        };
      }
      if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY) {
        const code = cleanSpaces(String(state.propertyListingCode || ''));
        return {
          responseText: code
            ? `Perfecto. Para la referencia ${code}, ¿cómo te llamo para continuar?`
            : 'Con gusto. Para seguir, ¿cómo te llamas?',
          followUpQuestion: null,
          awaitingField: 'full_name',
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: 'Con gusto. Para seguir, ¿cómo te llamas?',
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

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<import('../planner/qualificationPlanner').evaluateQualification>} plannerOut
 * @param {{ action: string }} handoffOut
 */
function composeFromPlannerContext(state, decision, plannerOut, handoffOut) {
  const intent = decision.detectedIntent;

  if (intent === V3_INTENT.CAMPAIGN_GENERIC_TOUCH) return composeCampaignGenericTouch(state);

  if (intent === V3_INTENT.GREETING) return composeAdvisorGreeting(state);

  if (handoffOut.action === 'CONSENT_ACCEPTED' || handoffOut.action === 'HANDOFF_COMPLETE') {
    return composeConsentAccepted(state);
  }
  if (handoffOut.action === 'CONSENT_DECLINED') return composeConsentDeclined(state);
  if (handoffOut.action === 'OFFER_HANDOFF') {
    if (
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY ||
      (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY && state.propertyListingCode)
    ) {
      return composeHandoffPropertyOrCode(state);
    }
    return composeHandoffOffer(state);
  }

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
  formatMoneyMx,
  firstName,
};
