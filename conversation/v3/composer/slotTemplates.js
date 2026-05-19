'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');
const { CONVERSATION_GOALS, CONVERSATION_STAGES, V3_INTENT } = require('../types/constants');
const { getBuyDemandPolicyHint } = require('./buyDemandComposer');
const { isPostHandoffTerminalState } = require('../interpreter/objectionClassifier');
const { composePostHandoffAck, composeHandoffPendingContinuity } = require('./postHandoffComposer');
const { occupancyStatusLabel } = require('../interpreter/occupancyParser');
const {
  pickOpeningVariant,
  shouldSuppressGlobalIntentMenu,
  composeGenericUnderstandingPrompt,
  composeSocialRapportReply,
  composeRentDemandKickoff,
  GLOBAL_OPENING_VARIANTS,
} = require('./openingVariantPicker');
const { isSlotFilled } = require('../state/slotFillState');
const { evaluateQualification } = require('../planner/qualificationPlanner');
const { composeObjectionReply } = require('./objectionComposer');
const { isOfferValuationUnknownRequest } = require('../interpreter/offerValuationSignals');

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string|null|undefined} preferredSlot
 */
function resolveNextUnfilledSlot(state, preferredSlot) {
  if (preferredSlot && !isSlotFilled(state, preferredSlot)) return preferredSlot;
  return evaluateQualification(state).nextSlot;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string|null|undefined} preferredSlot
 */
function composePlannerSlotQuestion(state, preferredSlot) {
  const slot = resolveNextUnfilledSlot(state, preferredSlot);
  if (!slot) return null;
  return composeSlotQuestion(state, slot);
}

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

function getCommunicableExpectedPriceLabel(state) {
  const amount = Number(state?.expectedPrice);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (state?.priceUnknown === true) return null;
  return formatMoneyMx(amount);
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

  if (shouldSuppressGlobalIntentMenu(st)) {
    const continuity = composeGenericUnderstandingPrompt(st);
    return continuity;
  }

  const staticOpening = GLOBAL_OPENING_VARIANTS[0];
  const repeatGreetingOnly =
    !st.conversationGoalLocked &&
    !st.leadFlow &&
    String(st.lastComposerIntent || '').includes('GREETING');
  const userHolaOnly = normalizeText(String(st.lastUserText || '')) === 'hola';
  if (!st.conversationGoalLocked && !st.leadFlow && userHolaOnly) {
    return {
      responseText: staticOpening,
      followUpQuestion: null,
      awaitingField: null,
      toneFlags: { consultive: true, advisorPersona: true },
    };
  }

  return {
    responseText: pickOpeningVariant(st, [...GLOBAL_OPENING_VARIANTS]),
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
  if (isSlotFilled(state, slotId)) return null;
  const nm = firstName(state);
  const zone = state.locationText || 'esa zona';
  const isBuy = state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY;

  switch (slotId) {
    case 'intent':
      return composeAdvisorGreeting(state);
    case 'full_name':
      if (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
        if (state.flowSwitchAck) {
          return {
            responseText:
              'Entendido, cambiamos de rumbo: te acompaño con la venta de tu propiedad. ¿Me dices tu nombre?',
            followUpQuestion: null,
            awaitingField: 'full_name',
            toneFlags: { consultive: true, flowSwitch: true },
          };
        }
        return {
          responseText: pickOpeningVariant(state, [
            'Claro, te apoyo con la venta. Para orientarte mejor, ¿me compartes tu nombre?',
            'Perfecto, te acompaño con la venta de tu propiedad. ¿Me dices tu nombre?',
            'Con gusto, seguimos con la venta. ¿Cómo te llamas?',
          ]),
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
      if (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY) {
        return {
          responseText: pickOpeningVariant(state, [
            'Perfecto, te ayudo con la renta. ¿Me compartes tu nombre?',
            'Claro, seguimos con la renta. ¿Cómo te llamas?',
            'De acuerdo. Para continuar con la búsqueda en renta, ¿me dices tu nombre?',
          ]),
          followUpQuestion: null,
          awaitingField: 'full_name',
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: pickOpeningVariant(state, [
          'Con gusto. Para continuar, ¿me compartes tu nombre?',
          'Perfecto. ¿Me dices tu nombre para seguir?',
          'Claro. ¿Cómo te llamas?',
        ]),
        followUpQuestion: null,
        awaitingField: 'full_name',
        toneFlags: { consultive: true },
      };
    case 'location_text':
      if (isBuy) {
        return {
          responseText: '¿En qué zona te gustaría buscar?',
          followUpQuestion: null,
          awaitingField: 'location_text',
          toneFlags: { consultive: true },
        };
      }
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
      if (isBuy) {
        return {
          responseText: pickOpeningVariant(state, [
            zone && zone !== 'esa zona'
              ? `¿Qué presupuesto aproximado manejas para buscar en ${zone}?`
              : '¿Qué presupuesto aproximado manejas?',
            zone && zone !== 'esa zona'
              ? `Para ${zone}, ¿qué rango de presupuesto tienes en mente?`
              : '¿Qué rango de presupuesto manejas?',
          ]),
          followUpQuestion: null,
          awaitingField: 'budget',
          toneFlags: { consultive: true },
        };
      }
      if (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY) {
        return {
          responseText: pickOpeningVariant(state, [
            nm
              ? `Perfecto, ${nm}. En ${zone}, ¿qué presupuesto mensual manejas?`
              : `En ${zone}, ¿qué presupuesto mensual manejas?`,
            nm
              ? `Gracias, ${nm}. Para ${zone}, ¿qué renta mensual te queda cómoda?`
              : `Para ${zone}, ¿qué renta mensual te queda cómoda?`,
          ]),
          followUpQuestion: null,
          awaitingField: 'budget',
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: nm
          ? `Perfecto, ${nm}. En ${zone}, ¿qué presupuesto aproximado manejas?`
          : `En ${zone}, ¿qué presupuesto aproximado manejas?`,
        followUpQuestion: null,
        awaitingField: 'budget',
        toneFlags: { consultive: true },
      };
    case 'property_type':
      if (isBuy) {
        return {
          responseText: '¿Buscas casa, departamento o terreno?',
          followUpQuestion: null,
          awaitingField: 'property_type',
          toneFlags: { consultive: true },
        };
      }
      return {
        responseText: nm
          ? `Entendido, ${nm}. ¿Es casa, departamento o terreno?`
          : '¿Es casa, departamento o terreno?',
        followUpQuestion: null,
        awaitingField: 'property_type',
        toneFlags: { consultive: true },
      };
    case 'bedrooms':
      return {
        responseText: '¿Cuántas recámaras necesitas?',
        followUpQuestion: null,
        awaitingField: 'bedrooms',
        toneFlags: { consultive: true },
      };
    case 'occupancy_status': {
      const tipo = propertyTypeLabel(state);
      const pres = getCommunicableExpectedPriceLabel(state);
      const context = pres
        ? `Tengo tu ${tipo} en ${zone} con precio esperado de ${pres}.`
        : `Tengo tu ${tipo} en ${zone}.`;
      return {
        responseText: `Perfecto, ${nm}. ${context} ¿Está habitada, rentada o libre?`,
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
  const pres = getCommunicableExpectedPriceLabel(state);
  const rangeHint = pres ? `Por la zona y el rango (${pres}) que me comentas, sí vale la pena revisarla bien.` : `Por lo que me comentas de ${zone}, sí vale la pena revisarla bien.`;

  return {
    responseText: `Perfecto, ${nm}. ${rangeHint} Si te parece, puedo pedirle a uno de nuestros asesores de Luxetty que te contacte para ayudarte con una valuación más precisa.`,
    followUpQuestion: null,
    awaitingField: 'advisor_contact_consent',
    toneFlags: { consultive: true, handoff: true },
  };
}

/**
 * Handoff consultivo compra abierta (F3.2).
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeHandoffBuyDemand(state) {
  const nm = firstName(state) || 'perfecto';
  const zone = state.locationText || 'esa zona';
  const pres = state.budget != null ? formatMoneyMx(state.budget) : null;
  const rangeHint = pres
    ? `Con ${pres} en ${zone} sí vale revisar opciones contigo.`
    : `En ${zone} sí vale revisar opciones contigo.`;

  return {
    responseText: `Perfecto, ${nm}. ${rangeHint} ¿Te parece si un asesor de Luxetty te contacta por aquí?`,
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

function composeTopicPivotAck(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const zone = st.locationText || null;
  const nm = firstName(st);
  if (zone) {
    const head = nm ? `${nm}, entendido` : 'Entendido';
    return {
      responseText: `${head}: dejamos lo anterior. En ${zone}, ¿qué presupuesto aproximado manejas?`,
      followUpQuestion: null,
      awaitingField: 'budget',
      toneFlags: { consultive: true, topicPivot: true },
    };
  }
  return {
    responseText:
      'Entendido, dejamos lo anterior. ¿En qué zona quieres enfocar la búsqueda ahora?',
    followUpQuestion: null,
    awaitingField: 'location_text',
    toneFlags: { consultive: true, topicPivot: true },
  };
}

function composePropertyLookupMiss(state = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const code = cleanSpaces(String(st.propertyListingCode || ''));
  const ref = code ? `la referencia ${code}` : 'ese código';
  return {
    responseText: `No encuentro ${ref} en inventario publicado por este canal, así que no invento precio ni ficha. ¿Puedes confirmar el código completo (ej. LUX-A0470) o prefieres que busquemos por zona y presupuesto?`,
    followUpQuestion: null,
    awaitingField: null,
    toneFlags: { consultive: true, propertyMiss: true },
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
    case 'compare': {
      const hist = Array.isArray(st.propertyHistory) ? st.propertyHistory : [];
      const prev = hist.find((h) => h && h.code && h.code !== code);
      const other = prev?.code || hist[0]?.code || null;
      const otherRef = other ? ` (antes viste ${other})` : '';
      return {
        responseText: `${greet}Para comparar, tomo ${ref} como referencia actual${otherRef}. Dime si quieres precio, zona o recámaras de ${code || 'esta ficha'} y no mezclo datos de otra propiedad.`,
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true, propertyCompare: true },
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

  if (handoffOut.action === 'CONSENT_ACCEPTED' || handoffOut.action === 'HANDOFF_COMPLETE') {
    return { text, replaced: false };
  }

  if (isPostHandoffTerminalState(state)) {
    const prev = String(state.lastAssistantReply || '');
    if (prev && (isCommercialHandoffReply(text) || isCommercialHandoffReply(prev))) {
      return { text: composePostHandoffAck(state).responseText, replaced: true };
    }
    return { text, replaced: false };
  }

  if (
    state.conversationStage === CONVERSATION_STAGES.HANDOFF_PENDING ||
    state.handoffStage === CONVERSATION_STAGES.HANDOFF_PENDING
  ) {
    const prev = String(state.lastAssistantReply || '');
    const userShort = /^(hola|hey|buenas|ok|si|sí|vale)$/i.test(
      normalizeText(String(state.lastUserText || '')),
    );
    if (
      userShort &&
      prev &&
      isCommercialHandoffReply(prev) &&
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY
    ) {
      return { text: composePropertyLoopBreak(state), replaced: true };
    }
    if (prev && isCommercialHandoffReply(text) && isCommercialHandoffReply(prev)) {
      if (
        state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY &&
        state.propertyListingCode
      ) {
        return { text: composePropertyLoopBreak(state), replaced: true };
      }
      return { text: composeHandoffPendingContinuity(state).responseText, replaced: true };
    }
  }

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
    if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY && state.propertySubMode === 'PROPERTY_QA') {
      return { text: composePropertyLoopBreak(state), replaced: true };
    }
    return { text: composeHandoffPendingContinuity(state).responseText, replaced: true };
  }
  return { text, replaced: false };
}

/**
 * Reconoce slots capturados fuera de orden (sticky M1-B).
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function composeDemandRefinementTurn(state, decision) {
  const kind = decision.refinementKind || null;
  const zone = state.locationText;
  const nm = firstName(state);

  if (kind === 'zone' && !zone) {
    return {
      responseText: pickOpeningVariant(state, [
        'Perfecto, ajustamos la búsqueda. ¿En qué zona prefieres enfocarte ahora?',
        'Entendido, cambiamos de zona. ¿Qué colonia o sector te interesa?',
      ]),
      followUpQuestion: null,
      awaitingField: 'location_text',
      toneFlags: { consultive: true, refinement: true },
    };
  }

  if (kind === 'budget_down' && state.budget == null) {
    return {
      responseText: pickOpeningVariant(state, [
        'Entendido, buscamos opciones más económicas. ¿Hasta qué presupuesto te gustaría ajustar?',
        'Tomé que quieres algo más accesible. ¿Qué presupuesto máximo manejas?',
      ]),
      followUpQuestion: null,
      awaitingField: 'budget',
      toneFlags: { consultive: true, refinement: true },
    };
  }

  if (kind === 'size_up') {
    const br = state.bedrooms != null ? state.bedrooms : null;
    const brTxt = br != null ? `${br} recámaras` : 'más espacio';
    const budgetNote = state.budget != null ? '' : ' y presupuesto';
    return {
      responseText: pickOpeningVariant(state, [
        `Perfecto, priorizo algo más amplio (${brTxt}). ¿Mantengo la misma zona${zone ? ` (${zone})` : ''}${budgetNote}?`,
        nm
          ? `${nm}, tomé que buscas más espacio. ¿Seguimos en la misma zona o quieres mover la búsqueda?`
          : 'Tomé que buscas algo más grande. ¿Seguimos en la misma zona o movemos algún detalle?',
      ]),
      followUpQuestion: null,
      awaitingField: zone && state.budget == null ? 'budget' : null,
      toneFlags: { consultive: true, refinement: true },
    };
  }

  if (kind === 'feature_patio') {
    const budgetQ =
      state.budget == null
        ? '¿Qué presupuesto manejas?'
        : '¿Algún otro detalle que quieras sumar?';
    return {
      responseText: pickOpeningVariant(state, [
        `Perfecto, priorizo opciones con patio${zone ? ` en ${zone}` : ''}. ${budgetQ}`,
        `Tomé el detalle del patio${zone ? ` en ${zone}` : ''}. ${budgetQ}`,
      ]),
      followUpQuestion: null,
      awaitingField: state.budget == null ? 'budget' : null,
      toneFlags: { consultive: true, refinement: true },
    };
  }

  return {
    responseText: pickOpeningVariant(state, [
      'Entendido, ajusto los criterios de tu búsqueda. ¿Qué quieres cambiar: zona, presupuesto o tamaño?',
      'Perfecto, sigo con tu compra. ¿Afinamos zona, presupuesto o algún detalle como patio?',
    ]),
    followUpQuestion: null,
    awaitingField: state.awaitingField,
    toneFlags: { consultive: true, refinement: true },
  };
}

function composeStickyQualificationTurn(state, decision) {
  const intent = decision.detectedIntent;
  const nm = firstName(state);
  const zone = state.locationText;
  const pres = getCommunicableExpectedPriceLabel(state);
  const budget = formatMoneyMx(state.budget);

  if (intent === V3_INTENT.LOCATION_CAPTURE && zone) {
    if (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
      const priceOk =
        state.expectedPrice != null ||
        state.valuationRequested === true ||
        state.priceUnknown === true;
      if (state.collectedFields?.fullName && priceOk) {
        return {
          responseText: pickOpeningVariant(state, [
            `Perfecto, tomé la zona (${zone}). ¿Cómo está la ocupación (libre, habitada, rentada)?`,
            `Gracias, registré ${zone}. ¿La propiedad está libre, habitada o rentada?`,
          ]),
          followUpQuestion: null,
          awaitingField: state.occupancyStatus ? null : 'occupancy_status',
          toneFlags: { consultive: true, stickyAck: true },
        };
      }
      const variants = [
        `Tomé la zona (${zone}). ¿Qué precio esperado manejas para la venta?`,
        `Perfecto, registré ${zone}. ¿Tienes un precio en mente?`,
        nm ? `Gracias, ${nm}. Tomé ${zone}. ¿Qué precio esperado manejas?` : `Tomé ${zone}. Para seguir con la venta, ¿qué precio esperado manejas?`,
      ];
      return {
        responseText: pickOpeningVariant(state, variants),
        followUpQuestion: null,
        awaitingField: state.expectedPrice == null ? 'expected_price' : 'full_name',
        toneFlags: { consultive: true, stickyAck: true },
      };
    }
    if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
      const pres = formatMoneyMx(state.budget);
      if (state.collectedFields?.fullName && state.budget != null) {
        return {
          responseText: pickOpeningVariant(state, [
            `Perfecto, movimos la búsqueda a ${zone}. Mantengo tu presupuesto de ${pres}. ¿Quieres afinar tamaño o algún detalle?`,
            nm
              ? `Gracias, ${nm}. Tomé ${zone} con ${pres} como referencia. ¿Algún detalle más (recámaras, patio)?`
              : `Tomé ${zone}. Con ${pres} como referencia, ¿afinamos tamaño o algún detalle?`,
          ]),
          followUpQuestion: null,
          awaitingField: null,
          toneFlags: { consultive: true, stickyAck: true, zoneRefinement: true },
        };
      }
      return {
        responseText: pickOpeningVariant(state, [
          `Perfecto, tomé ${zone}. ¿Qué presupuesto aproximado manejas?`,
          `Gracias. Para buscar en ${zone}, ¿qué presupuesto tienes en mente?`,
          nm ? `Gracias, ${nm}. En ${zone}, ¿qué presupuesto aproximado manejas?` : `En ${zone}, ¿qué presupuesto aproximado manejas?`,
        ]),
        followUpQuestion: null,
        awaitingField: state.budget == null ? 'budget' : 'full_name',
        toneFlags: { consultive: true, stickyAck: true },
      };
    }
  }

  if (intent === V3_INTENT.SELLER_PRICE && state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
    if (state.collectedFields?.fullName) {
      return {
        responseText: pickOpeningVariant(state, [
          pres
            ? `Tomé un precio esperado de ${pres}. ¿Cómo está la ocupación (libre, habitada, rentada)?`
            : 'Tomé el precio. ¿Cómo está la ocupación de la propiedad?',
        ]),
        followUpQuestion: null,
        awaitingField: state.occupancyStatus ? null : 'occupancy_status',
        toneFlags: { consultive: true, stickyAck: true },
      };
    }
    return {
      responseText: pickOpeningVariant(state, [
        pres ? `Tomé un precio esperado de ${pres}. ¿Me compartes tu nombre?` : 'Tomé el precio. ¿Me compartes tu nombre?',
        pres ? `Perfecto, ${pres} como referencia. Para seguir, ¿cómo te llamas?` : 'Gracias por el dato. ¿Me dices tu nombre?',
      ]),
      followUpQuestion: null,
      awaitingField: 'full_name',
      toneFlags: { consultive: true, stickyAck: true },
    };
  }

  if (intent === V3_INTENT.BUYER_BUDGET && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    if (state.collectedFields?.fullName) {
      return {
        responseText: pickOpeningVariant(state, [
          budget
            ? `Perfecto, ajusté el presupuesto a ${budget}. ¿Quieres afinar zona, recámaras o algún detalle?`
            : 'Tomé tu presupuesto. ¿Quieres afinar zona o recámaras?',
          budget
            ? `Listo, con ${budget} como referencia. ¿Movemos zona o algún detalle como patio?`
            : 'Gracias por el dato. ¿Seguimos afinando zona o tamaño?',
        ]),
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true, stickyAck: true },
      };
    }
    return {
      responseText: pickOpeningVariant(state, [
        budget ? `Tomé un presupuesto de ${budget}. ¿Me compartes tu nombre?` : 'Tomé tu presupuesto. ¿Me compartes tu nombre?',
        budget ? `Perfecto, con ${budget} podemos afinar opciones. ¿Cómo te llamas?` : 'Gracias. ¿Me dices tu nombre?',
      ]),
      followUpQuestion: null,
      awaitingField: 'full_name',
      toneFlags: { consultive: true, stickyAck: true },
    };
  }

  return null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<import('../planner/qualificationPlanner').evaluateQualification>} plannerOut
 * @param {{ action: string }} handoffOut
 */
function shouldComposeSellValuationUnknown(state, decision) {
  if (state.conversationGoal !== CONVERSATION_GOALS.SELL_PROPERTY) return false;
  if (!(state.priceUnknown || state.valuationRequested)) return false;
  const last = String(state.lastUserText || '');
  if (isOfferValuationUnknownRequest(last)) return true;
  return (
    decision?.detectedIntent === V3_INTENT.UNKNOWN &&
    Boolean(state.collectedFields?.fullName) &&
    Boolean(state.locationText)
  );
}

function composeFromPlannerContext(state, decision, plannerOut, handoffOut) {
  const intent = decision.detectedIntent;

  if (state.topicPivotTurn) {
    return composeTopicPivotAck(state);
  }

  const stickyAck = composeStickyQualificationTurn(state, decision);
  if (stickyAck) return stickyAck;

  if (shouldComposeSellValuationUnknown(state, decision)) {
    const composed = composeObjectionReply('sell_valuation_unknown', state);
    if (composed) return composed;
  }

  if (intent === V3_INTENT.DEMAND_REFINEMENT && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    return composeDemandRefinementTurn(state, decision);
  }

  const buyPolicyHint = getBuyDemandPolicyHint(state, decision, plannerOut, handoffOut);
  if (buyPolicyHint) {
    const slotQ = buyPolicyHint.nextSlot ? composeSlotQuestion(state, buyPolicyHint.nextSlot) : null;
    if (buyPolicyHint.kind === 'geo_out_of_coverage' && state.locationText) {
      const zone = state.locationText;
      const tail =
        slotQ && slotQ.responseText
          ? ` ${slotQ.responseText}`
          : ' Si te parece, un asesor de Luxetty puede orientarte sobre alternativas.';
      return {
        responseText: `Gracias por comentarlo. Por ahora nuestro inventario activo está en el área metropolitana de Monterrey (Cumbres, San Pedro, Carretera Nacional y zona sur); para ${zone} no tenemos cobertura directa en catálogo.${tail}`,
        followUpQuestion: slotQ?.followUpQuestion || null,
        awaitingField: slotQ?.awaitingField ?? buyPolicyHint.nextSlot ?? state.awaitingField,
        toneFlags: { consultive: true, geoPolicy: true },
      };
    }
    if (buyPolicyHint.kind === 'price_below_floor' && state.budget != null) {
      const pres = formatMoneyMx(state.budget);
      const tail =
        slotQ && slotQ.responseText
          ? ` ${slotQ.responseText}`
          : ' ¿En qué zona te gustaría enfocar la búsqueda?';
      return {
        responseText: `Tomé un presupuesto de ${pres}. En compra, ese rango puede tener menos opciones premium, pero sí vale explorar con cuidado.${tail}`,
        followUpQuestion: slotQ?.followUpQuestion || null,
        awaitingField: slotQ?.awaitingField ?? buyPolicyHint.nextSlot ?? state.awaitingField,
        toneFlags: { consultive: true, pricePolicy: true },
      };
    }
    if (buyPolicyHint.kind === 'price_ambiguous') {
      return {
        responseText: 'Para orientarte mejor, ¿qué presupuesto aproximado manejas (en millones de pesos)?',
        followUpQuestion: null,
        awaitingField: 'budget',
        toneFlags: { consultive: true, pricePolicy: true },
      };
    }
  }

  if (
    intent === V3_INTENT.PROPERTY_FACT_QUESTION &&
    state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY
  ) {
    const fam = decision.propertyInquiryFamily || 'generic';
    const hasFacts = !!(state.activeProperty && state.activeProperty.id);
    if ((fam === 'price' || fam === 'availability') && !hasFacts) {
      return composePropertyLookupMiss(state);
    }
    return composePropertyFactReply(state, fam);
  }

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
      const hasFacts = !!(state.activeProperty && state.activeProperty.id);
      if ((fam === 'price' || fam === 'availability') && !hasFacts) {
        return composePropertyLookupMiss(state);
      }
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
    if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
      return composeHandoffBuyDemand(state);
    }
    return composeHandoffOffer(state);
  }

  if (intent === V3_INTENT.GREETING) return composeAdvisorGreeting(state);

  if (intent === V3_INTENT.SOCIAL_RAPPORT) return composeSocialRapportReply(state);

  if (intent === V3_INTENT.RENT_PROPERTY) {
    if (!state.collectedFields?.fullName && !state.locationText) {
      return composeRentDemandKickoff(state);
    }
    if (!state.collectedFields?.fullName) {
      return composeSlotQuestion(state, 'full_name');
    }
    if (!state.locationText) {
      return composeSlotQuestion(state, 'location_text');
    }
    if (state.budget == null) {
      return composeSlotQuestion(state, 'budget');
    }
  }

  if (intent === V3_INTENT.SELL_PROPERTY) {
    if (!state.collectedFields?.fullName && !state.locationText) {
      return {
        responseText: pickOpeningVariant(state, [
          'Con gusto, te apoyo con el valor de tu propiedad. ¿En qué zona está y cómo te llamas?',
          'Perfecto, te ayudo con la orientación de valuación. ¿Me compartes la zona y tu nombre?',
        ]),
        followUpQuestion: null,
        awaitingField: 'location_text',
        toneFlags: { consultive: true, valuationLead: true },
      };
    }
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    if (!state.locationText) return composeSlotQuestion(state, 'location_text');
    return composeSlotQuestion(state, 'expected_price');
  }

  if (intent === V3_INTENT.PROPERTY_INQUIRY) {
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    if (plannerOut.nextSlot) return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.RENT_OUT_PROPERTY) {
    if (!state.collectedFields?.fullName) return composeSlotQuestion(state, 'full_name');
    return composeSlotQuestion(state, 'location_text');
  }

  if (intent === V3_INTENT.IDENTITY_CAPTURE && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.LOCATION_CAPTURE && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.SELLER_PRICE && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.PROPERTY_TYPE_CAPTURE && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.OCCUPANCY_CAPTURE) {
    const occ = state.occupancyStatus || state.collectedFields?.occupancyStatus;
    if (occ && handoffOut.action === 'OFFER_HANDOFF') {
      return composeHandoffOffer(state);
    }
  }

  if (plannerOut.nextSlot) return composePlannerSlotQuestion(state, plannerOut.nextSlot);

  if (plannerOut.qualificationComplete && handoffOut.action === 'OFFER_HANDOFF') {
    if (
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY ||
      (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY && state.propertyListingCode)
    ) {
      return composeHandoffPropertyOrCode(state);
    }
    if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
      return composeHandoffBuyDemand(state);
    }
    return composeHandoffOffer(state);
  }

  if (intent === V3_INTENT.BUY_PROPERTY && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.BUYER_BUDGET && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (intent === V3_INTENT.BEDROOMS_CAPTURE && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY && plannerOut.nextSlot) {
    return composePlannerSlotQuestion(state, plannerOut.nextSlot);
  }

  if (
    intent === V3_INTENT.UNKNOWN &&
    (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY ||
      state.conversationGoal === CONVERSATION_GOALS.RENT_OUT_PROPERTY) &&
    (state.priceUnknown || state.valuationRequested) &&
    isOfferValuationUnknownRequest(state.lastUserText || '')
  ) {
    const kind =
      state.conversationGoal === CONVERSATION_GOALS.RENT_OUT_PROPERTY
        ? 'sell_valuation_unknown'
        : 'sell_valuation_unknown';
    const composed = composeObjectionReply(kind, state);
    if (composed) return composed;
  }

  if (intent === V3_INTENT.UNKNOWN && shouldSuppressGlobalIntentMenu(state)) {
    return composeGenericUnderstandingPrompt(state);
  }

  return composeGenericUnderstandingPrompt(state);
}

module.exports = {
  composeAdvisorGreeting,
  composeCampaignGenericTouch,
  composeHandoffPropertyOrCode,
  composeSlotQuestion,
  composeHandoffOffer,
  composeHandoffBuyDemand,
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
