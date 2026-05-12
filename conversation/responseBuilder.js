const {
  formatMoney,
  formatPropertyTypeLabel,
  formatPropertyShort,
  formatPropertyList,
} = require('../utils/formatting');
const { safeJsonStringify } = require('../utils/helpers');
const {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
} = require('./perseoConsultantPrompt');
const { openai } = require('../services/openaiService');
const { qualifiesDemandValue } = require('./searchRules');
const { cleanSpaces } = require('../utils/text');

function buildAiSummary(state, properties = []) {
  const parts = [];

  if (state.full_name) parts.push(`Nombre: ${state.full_name}.`);

  if (state.lead_flow === 'demand') {
    parts.push(`Lead buscando ${state.operation_type === 'rent' ? 'renta' : 'compra'}.`);
  } else if (state.lead_flow === 'offer') {
    parts.push(`Lead quiere ${state.operation_type === 'rent' ? 'poner en renta' : 'vender'} su propiedad.`);
  }

  if (state.property_code) {
    parts.push(`Referencia directa a propiedad por ID oficial: ${state.property_code}.`);
  }

  if (state.property_type) {
    parts.push(`Tipo: ${formatPropertyTypeLabel(state.property_type)}.`);
  }

  if (state.location_text) {
    parts.push(`Ubicación: ${state.location_text}.`);
  } else if (state.location_any) {
    parts.push('Ubicación abierta.');
  }

  if (state.budget_max) {
    parts.push(`Monto: ${formatMoney(state.budget_max, state.budget_currency || 'MXN')}.`);
  }

  if (state.owner_relation) {
    parts.push(`Relación con propiedad: ${state.owner_relation}.`);
  }

  if (state.contact_preference) {
    parts.push(`Canal preferido: ${state.contact_preference}.`);
  }

  if (state.timeline_text) {
    parts.push(`Tiempo: ${state.timeline_text}.`);
  }

  if (state.contact_number_confirmed === true) {
    parts.push('Número confirmado.');
  }

  if (state.wants_visit) parts.push('Quiere agendar visita.');
  if (state.shows_high_interest) parts.push('Muestra alto interés.');
  if (state.asks_property_details) parts.push('Está pidiendo más detalles de la propiedad.');
  if (state.direct_property_reference) parts.push('Entró por referencia directa de propiedad.');

  if (properties.length > 0) {
    parts.push(`Resultados actuales: ${properties.length}.`);
  } else if (state.last_search_result_count === 0 && state.lead_flow === 'demand') {
    parts.push('Sin resultados exactos en última búsqueda.');
  }

  return parts.join(' ').trim() || null;
}

function buildLowInfoCampaignReply(hasCampaignContext = false, campaignContext = null) {
  if (!hasCampaignContext) {
    return 'Claro, con gusto te ayudo. Para ubicarte bien, ¿buscas comprar, rentar, vender o poner en renta una propiedad?';
  }

  const campaignType = campaignContext?.campaign_type || 'unknown';
  const propertyCode = campaignContext?.property_code || null;

  if (campaignType === 'seller_capture' || campaignType === 'valuation') {
    return 'Vi que llegas por el anuncio para propietarios. ¿Buscas vender una propiedad o quieres una valuación inicial?';
  }

  if (campaignType === 'property_listing' && propertyCode) {
    return `Claro. Te comparto la información de esta propiedad ${propertyCode}. ¿Quieres que un asesor confirme disponibilidad, precio y opción de visita?`;
  }

  return 'Claro, con gusto te ayudo con el anuncio que viste. Te puedo apoyar con venta, compra, renta o valuación de propiedades. ¿Qué necesitas revisar?';
}

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') {
      return 'Entendido, avanzamos con la venta.';
    }
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') {
      return 'Entendido, avanzamos con ponerla en renta.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') {
      return 'Entendido, avanzamos con la búsqueda de compra.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') {
      return 'Entendido, avanzamos con la búsqueda de renta.';
    }
  }

  if (changeType === 'radical_change') {
    if (state.location_any) return 'Entendido, amplío la búsqueda.';
    if (state.location_text) return `Entendido, actualizo la búsqueda a ${state.location_text}.`;
    return 'Entendido, actualizo la búsqueda.';
  }

  if (changeType === 'minor_update') return 'Con gusto, lo actualizo.';
  return 'Entendido.';
}

function buildDemandLowValueReply(state) {
  if (state.operation_type === 'sale') {
    return 'Por el momento nos especializamos en propiedades en compra desde $3,000,000 MXN. Si deseas, podemos ajustar la búsqueda o un asesor de Luxetty puede orientarte sobre alternativas.';
  }

  return 'Por el momento nos especializamos en propiedades en renta desde $10,000 MXN. Si deseas, podemos ajustar el rango o un asesor de Luxetty puede orientarte.';
}

function buildOfferRejectedReply(state) {
  if (state.geo_qualified === false) {
    return 'Por el momento nos especializamos en zonas de alto valor en Monterrey y área metropolitana. Si deseas, puedo canalizar tu caso con un asesor de Luxetty para más orientación.';
  }

  if (state.value_qualified === false) {
    return 'Por el momento nos especializamos en propiedades de mayor valor. Con gusto puedo canalizarte con un asesor de Luxetty si deseas más información.';
  }

  return 'Para darte una respuesta precisa, puedo canalizar tu caso con un asesor de Luxetty que lo revise contigo.';
}

function buildFinalHandoffReply(state) {
  const name = state.full_name ? `, ${state.full_name}` : '';
  const channel =
    state.contact_preference === 'call'
      ? 'por llamada'
      : 'por WhatsApp';

  if (state.lead_flow === 'offer') {
    return `Perfecto${name}. Ya dejé tu caso listo y un asesor de Luxetty te contactará ${channel} para revisarlo contigo.`;
  }

  if (state.wants_visit) {
    return `Perfecto${name}. Ya dejé tu solicitud para coordinar la visita y un asesor te contactará ${channel} para avanzar contigo.`;
  }

  if (state.direct_property_reference && state.property_code) {
    return `Perfecto${name}. Ya dejé registrada tu solicitud sobre la propiedad con ID ${state.property_code} y un asesor de Luxetty te contactará ${channel} para ayudarte a avanzar.`;
  }

  return `Perfecto${name}. Ya dejé tu búsqueda lista y un asesor de Luxetty te contactará ${channel} para ayudarte a avanzar con las mejores opciones.`;
}

function getDemandMatchQuality(state, properties = []) {
  if (state?.result_quality) return state.result_quality;

  if (!Array.isArray(properties) || properties.length === 0) {
    return 'none';
  }

  const topScore = Number(properties[0]?.match_score || 0);

  if (topScore >= 80) return 'strong';
  if (topScore >= 55) return 'medium';
  if (topScore >= 35) return 'weak';
  return 'very_weak';
}

function hasCommercialIntent(state) {
  return (
    !!state.wants_visit ||
    !!state.shows_high_interest ||
    !!state.asks_property_details ||
    !!state.direct_property_reference
  );
}

function getDemandActionClosing(state, matchQuality) {
  if (state.direct_property_reference && state.property_code) {
    if (state.wants_visit) {
      return '¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
    }

    if (state.asks_property_details) {
      return `¿Deseas que un asesor de Luxetty te dé más detalle sobre la propiedad con ID ${state.property_code}?`;
    }

    return '¿Deseas que un asesor de Luxetty la revise contigo y te oriente para avanzar?';
  }

  if (state.wants_visit) {
    return '¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
  }

  if (state.asks_property_details) {
    return '¿Deseas que un asesor de Luxetty te dé más detalle sobre esta opción?';
  }

  if (state.shows_high_interest) {
    return '¿Deseas que un asesor de Luxetty la revise contigo y te oriente para avanzar?';
  }

  if (matchQuality === 'strong') {
    return 'Es una muy buena opción. ¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
  }

  if (matchQuality === 'medium') {
    return 'Puede ser una buena opción. ¿Deseas que un asesor de Luxetty la revise contigo?';
  }

  return '¿Deseas ajustar la búsqueda o que un asesor de Luxetty te oriente?';
}

function getPropertyVisibleCode(property = {}, state = {}) {
  return (
    property.listing_id ||
    property.public_code ||
    state.property_code ||
    state.direct_property_code ||
    'esta propiedad'
  );
}

function getPropertyLocationLabel(property = {}) {
  return (
    property.neighborhood ||
    property.zone ||
    property.municipality ||
    property.city ||
    null
  );
}

function getPropertySlugUrl(property = {}) {
  const slug = typeof property.slug === 'string' ? property.slug.trim() : '';
  if (!slug || /\s/.test(slug)) return null;

  const cleanSlug = slug
    .replace(/^https?:\/\/(?:www\.)?luxetty\.com\/propiedad\//i, '')
    .replace(/^\/?propiedad\//i, '')
    .replace(/^\/+|\/+$/g, '');

  if (!cleanSlug || /\s/.test(cleanSlug)) return null;
  return `https://luxetty.com/propiedad/${cleanSlug}`;
}

function hasValidPropertyPrice(property = {}) {
  const price = Number(property.price);
  return Number.isFinite(price) && price > 0;
}

function buildPropertyAdvisorCta(state = {}, code = null) {
  if (state.full_name) {
    return `Si me autorizas, un asesor de Luxetty puede contactarte para apoyarte con detalles confirmados y visita de ${code || 'la propiedad'}. ¿Deseas que te contacte?`;
  }

  if (state.awaiting_field === 'full_name') {
    return 'Cuando puedas, compárteme solo tu nombre y con eso lo canalizo con asesor.';
  }

  return 'Para que un asesor de Luxetty pueda apoyarte con detalles confirmados y visita, ¿me compartes tu nombre?';
}

function pickPropertyInterestOpening(hasUrl) {
  const openings = hasUrl
    ? [
        'Claro. Te comparto la liga de la propiedad',
        'Perfecto, aquí está la liga de la propiedad',
        'Listo, te paso la liga de la propiedad',
      ]
    : [
        'Claro, identifiqué la propiedad',
        'Perfecto, ya identifiqué la propiedad',
        'Listo, encontré la propiedad',
      ];
  return openings[Math.floor(Math.random() * openings.length)];
}

function buildPropertyInterestReply(property, state = {}) {
  const code = getPropertyVisibleCode(property, state);
  const location = getPropertyLocationLabel(property);
  const url = getPropertySlugUrl(property);
  const locationText = location ? ` en ${location}` : '';

  if (!url) {
    return [
      `${pickPropertyInterestOpening(false)} ${code}${locationText}.`,
      `Para compartirte información confirmada, voy a canalizar tu caso con un asesor de Luxetty. ${buildPropertyAdvisorCta(state, code)}`,
    ];
  }

  return [
    `${pickPropertyInterestOpening(true)} ${code}${locationText}.`,
    url,
    `${buildPropertyAdvisorCta(state, code)} También puedo pedir que confirmen disponibilidad y precio actual.`,
  ];
}

function buildPropertyPriceReply(property, state = {}) {
  const code = getPropertyVisibleCode(property, state);
  const nameFollow =
    state.full_name && cleanSpaces(String(state.full_name))
      ? ''
      : '\n\nPara registrarte bien, ¿me compartes tu nombre?';

  if (!hasValidPropertyPrice(property)) {
    return `De momento no tengo un precio público confirmado para la propiedad ${code}. Te puedo compartir los detalles disponibles o revisarlo con un asesor.

¿Quieres que lo revisemos contigo?${nameFollow}`;
  }

  return `La propiedad ${code} está en ${formatMoney(property.price, property.currency_code || 'MXN')}.

¿Quieres verla esta semana?${nameFollow}`;
}

function buildDirectPropertyReply(state, changeType, properties = []) {
  const property = Array.isArray(properties) && properties.length > 0 ? properties[0] : null;

  if (!property) {
    return `No encontré una propiedad activa con el ID ${state.property_code}. Si deseas, puedo ampliar la búsqueda por zona o canalizar tu caso con un asesor de Luxetty para ayudarte.`;
  }

  const template = getPropertySlugUrl(property)
    ? 'property_interest_microcommitment'
    : 'property_interest_missing_slug_human_attention';

  console.log('PROPERTY INTEREST REPLY TEMPLATE:', {
    property_id: property?.id || null,
    property_code: getPropertyVisibleCode(property, state),
    slug_present: !!getPropertySlugUrl(property),
    template,
  });

  return buildPropertyInterestReply(property, state);
}

function buildDemandReply(state, changeType, properties, attemptUsed) {
  if (state.complaint_followup) {
    return 'Tienes razon, gracias por decirmelo. Te apoyo a retomarlo de inmediato con un asesor humano para dar continuidad puntual. Para ubicar tu seguimiento, ¿me confirmas tu nombre y si era por compra, renta o venta?';
  }

  if (state.direct_property_reference && state.property_code) {
    return buildDirectPropertyReply(state, changeType, properties);
  }

  const ack = getChangeAcknowledgement(changeType, state);
  const hasResults = Array.isArray(properties) && properties.length > 0;
  const matchQuality = getDemandMatchQuality(state, properties);
  const commercialIntent = hasCommercialIntent(state);

  if (!state.operation_type) {
    return 'Para orientarte mejor, ¿buscas comprar o rentar una propiedad?';
  }

  if (state.investor_profile) {
    return 'Perfecto, para inversion conviene evaluar liquidez, demanda de renta y precio de entrada, sin prometer rendimientos fijos. ¿Buscas flujo por renta o plusvalia?';
  }

  if (state.remote_client) {
    return 'Podemos avanzar totalmente en remoto con llamada y videollamada para que no dependas de estar en Monterrey. ¿Este WhatsApp es el mejor numero para contactarte?';
  }

  if (!state.location_text && !state.location_any) {
    return `${ack}\n¿En qué zona te interesa buscar?`;
  }

  if (state.budget_max == null) {
    return `${ack}\n¿Cuál es tu presupuesto aproximado?`;
  }

  if (!state.budget_currency) {
    return `${ack}\n¿Tu presupuesto es en MXN o USD?`;
  }

  if (!qualifiesDemandValue(state)) {
    return buildDemandLowValueReply(state);
  }

  if (matchQuality === 'very_weak') {
    return `${ack}\nNo encontré opciones que coincidan exactamente con lo que buscas. ¿Deseas ajustar los criterios o que un asesor de Luxetty te oriente?`;
  }

  if (hasResults) {
    if (properties.length === 1) {
      return `${ack}\nTe comparto una opción que vale la pena revisar:\n\n${formatPropertyShort(properties[0])}\n\n${getDemandActionClosing(state, matchQuality)}`;
    }

    return `${ack}\nEstas son las opciones más relevantes que encontré:\n\n${formatPropertyList(properties)}\n\n${getDemandActionClosing(state, matchQuality)}`;
  }

  const noExact = `${ack}\nNo encontré una coincidencia exacta en este momento.`;

  if (commercialIntent) {
    return `${noExact}\n¿Deseas que un asesor de Luxetty revise opciones contigo y te oriente para avanzar?`;
  }

  // 🔒 Anti-loop: si no hay cambio real y no hay propiedades
  if (
    !changeType &&
    (!properties || properties.length === 0)
  ) {
    return '¿Me compartes la zona, presupuesto aproximado y si buscas comprar o rentar?';
  }

  return `${noExact}\n¿Deseas ajustar la búsqueda o que un asesor de Luxetty te oriente hacia opciones más alineadas?`;
}

function buildOfferReply(state, changeType, context = {}) {
  const ack = getChangeAcknowledgement(changeType, state);
  const signals = context?.signals || {};

  if (state.complaint_followup || signals.complaint_followup) {
    const operationPrompt =
      state.operation_type === 'sale'
        ? 'venta'
        : state.operation_type === 'rent'
        ? 'renta'
        : 'compra, renta o venta';
    return `Tienes razon, gracias por comentarlo. Pauso lo comercial para retomar tu caso con prioridad y seguimiento humano. Para ubicarlo rapido, ¿me confirmas tu nombre y si era por ${operationPrompt}?`;
  }

  if (state.sell_buy_bridge || signals.sell_buy_bridge) {
    return 'Perfecto, podemos revisar ambas cosas: vender tu propiedad y buscar una opción para comprar. Para la compra, ¿en qué zona te gustaría buscar y con qué presupuesto aproximado cuentas? Y para la venta sigo con los datos de tu propiedad cuando me indiques.';
  }

  if (state.remote_client || signals.remote_client) {
    return 'Perfecto, podemos llevar este proceso de forma remota con llamada o videollamada y apoyo de un asesor local para ejecucion en campo. ¿Este WhatsApp es el mejor numero para contactarte?';
  }

  if (state.asks_valuation || signals.asks_valuation || signals.asks_only_valuation) {
    return 'Claro. Para valuar de forma responsable usamos comparativo de mercado (cierres reales, oferta competidora y absorcion), no un numero al aire. Podemos hacer una revision inicial y, si tiene sentido, agendar una visita breve para darte una referencia mas precisa. ¿La propiedad esta en Cumbres, Garcia, San Pedro, Carretera Nacional u otra zona?';
  }

  if (state.accepted_visit === true) {
    if (!state.full_name) {
      return 'Perfecto. Para coordinarlo, ¿me compartes tu nombre completo?';
    }

    if (!state.contact_preference) {
      return 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?';
    }

    if (state.contact_number_confirmed == null) {
      return '¿Este es el mejor número para contactarte y coordinar la visita?';
    }
  }

  if (state.urgent_sale_signal || signals.urgent_sale_signal || state.urgency_level === 'high') {
    return 'Entiendo la urgencia. Cuando se necesita vender rapido, lo clave es salir con precio y estrategia correctos desde el inicio, junto con papeleria clara y buena exposicion comercial. ¿La propiedad ya tiene papeleria lista o todavia habria que revisarla?';
  }

  if (signals.asks_direct_purchase) {
    return 'Entiendo perfecto. Nosotros no compramos propiedades directamente, pero sí podemos ayudarte a buscar al comprador adecuado con una estrategia comercial sólida.\n\n¿Me confirmas qué tipo de propiedad es y en qué zona se encuentra?';
  }

  if (signals.asks_commission) {
    return 'Buena pregunta. Normalmente la comisión se maneja como un porcentaje sobre el precio final de venta, pero más que una comisión aislada, lo importante es cuánto neto te queda y en cuánto tiempo se puede cerrar con buena estrategia, filtrado, promoción y negociación. ¿La propiedad ya está publicada o apenas estás evaluando vender?';
  }

  if (signals.asks_only_valuation) {
    return 'Claro. Para valuar con criterio comercial revisamos cierres reales, comparables y ritmo de absorcion de la zona. Si tiene sentido, coordinamos una visita breve para afinar el rango. ¿En que zona se encuentra tu propiedad?';
  }

  if (signals.objection_higher_other_agency) {
    return 'Puede pasar. La diferencia está en si ese valor está basado en oferta publicada o en cierres reales. Lo importante es evitar ponerla arriba del mercado y que se quede detenida. Por eso revisamos comparables y absorción actual.\n\n¿Te parece si revisamos primero los datos base de la propiedad para orientarte con números responsables?';
  }

  if (signals.objection_no_exclusivity) {
    return 'Es valido y totalmente entendible. En estos casos conviene revisar como evitar duplicidad, sobreexposicion y mensajes cruzados para cuidar la negociacion. ¿Actualmente ya la estas promoviendo con alguien?';
  }

  if (signals.objection_existing_realtor) {
    return 'Perfecto. ¿La están manejando en exclusiva o de forma abierta? Te pregunto porque eso cambia la forma en que podríamos apoyarte sin interferir con lo que ya tienes.';
  }

  if (state.legal_sensitive) {
    const pendingLegalQuestions = [];
    if (!state.occupancy_duration_text) pendingLegalQuestions.push('¿Hace cuánto tiempo está ocupada?');
    if (!state.occupancy_entry_mode) pendingLegalQuestions.push('¿La persona entró con permiso o fue despojo?');
    if (state.legal_deeded == null && state.has_documents == null) {
      pendingLegalQuestions.push('¿Cuentas con escritura, predial o registro público?');
    }
    if (!state.heirs_relation) {
      pendingLegalQuestions.push('¿Qué relación tienes con los herederos o con quien tiene poder?');
    }
    if (state.can_share_documents == null) {
      pendingLegalQuestions.push('¿Tienes documentos que puedas anexar para revisión inicial?');
    }

    if (pendingLegalQuestions.length > 0) {
      return `Gracias por explicarme tan bien. Este caso sí vale la pena revisarlo con cuidado; puede ser viable, pero hay que revisar documentación, ocupación y estrategia antes de definir la ruta. Lo correcto es revisarlo con enfoque comercial y jurídico.\n\n${pendingLegalQuestions.slice(0, 2).join(' ')}`;
    }

    return 'Entiendo perfecto. Con la información que compartiste, se ve como un caso sensible que requiere revisión comercial y jurídica antes de salir a mercado. Nosotros no compramos directamente, pero sí podemos ayudarte a buscar el comprador adecuado, incluso perfil inversionista, dependiendo del análisis.\n\n¿Me autorizas que una asesora especialista te contacte para revisar la ruta más viable?';
  }

  if (state.has_mortgage === true && !state.mortgage_balance_text) {
    return 'Sí se puede revisar aún con crédito vigente, pero sin definir estrategia final hasta revisar el saldo del crédito, banco y tiempos de liberación. ¿El crédito está al corriente?';
  }

  if (state.geo_qualified === false || state.value_qualified === false) {
    return buildOfferRejectedReply(state);
  }

  if (state.already_listed === true && (state.listing_duration_days || 0) >= 30) {
    return 'Gracias por explicarme tan bien. Cuando una propiedad ya estuvo publicada varias semanas sin resultados, normalmente no es por falta de difusión, sino por estrategia de precio y posicionamiento frente a su competencia real. Para darte una mejor orientación, conviene revisar valor de mercado, comparables y absorción de la zona.\n\n¿Me autorizas que lo revise contigo una asesora especialista para proponer una ruta de venta clara?';
  }

  if (state.primary_seller_scenario === 'seller_senior_downsizing' && !state.accepted_visit) {
    return 'Entiendo perfecto. Si la idea es que el matrimonio se cambie a una casa más chica, lo importante es definir una estrategia que dé salida real, no solo publicación. Para darte una recomendación seria, necesitamos validar comparables y recorrido en sitio.\n\n¿Te parece si coordinamos una visita rápida de 20 minutos con una asesora de esa zona?';
  }

  if (state.owner_relation == null) {
    return `${ack}\n¿La propiedad es tuya o estás apoyando a alguien?`;
  }

  if (!state.location_text) {
    return `${ack}\n¿En qué zona o colonia se encuentra la propiedad?`;
  }

  if (!state.property_type) {
    return `${ack}\n¿Es casa, departamento, terreno o local?`;
  }

  if (state.terrain_m2 == null && state.construction_m2 == null) {
    return 'Perfecto, gracias por la información. Para ubicar mejor el valor, ¿cuántos m² de terreno y construcción tiene aproximadamente?';
  }

  if (state.bedrooms == null || state.bathrooms == null || !state.occupancy_status) {
    return 'Con eso ya me doy una mejor idea. ¿Cuántas recámaras y baños tiene? ¿Actualmente está habitada o desocupada?';
  }

  if (state.floors_count == null || state.garage_spaces == null || state.has_terrace_patio == null) {
    return 'Entiendo. ¿Cuántas plantas y espacios de cochera tiene? ¿Cuenta con terraza o patio?';
  }

  if (state.legal_deeded == null) {
    return 'Para la parte comercial, ¿la propiedad está escriturada?';
  }

  if (state.has_mortgage == null) {
    return '¿Actualmente tiene crédito hipotecario o está libre de gravamen?';
  }

  if (state.has_mortgage === true && !state.mortgage_balance_text) {
    return 'Perfecto, entonces solo habría que revisar el saldo del crédito para calcular números correctos. ¿Tienes un saldo aproximado pendiente?';
  }

  if (state.works_with_realtor == null) {
    return '¿Actualmente ya estás trabajando con alguna inmobiliaria o apenas estás revisando opciones?';
  }

  if (!state.exclusivity_type) {
    return '¿La estarías manejando en exclusiva o de forma abierta?';
  }

  if (state.expected_price == null && state.budget_max == null) {
    return '¿Qué precio esperas para tu propiedad? Te lo pregunto para compararlo con cierres reales y absorción de la zona.';
  }

  if (!state.sale_motivation) {
    return 'Tiene sentido lo que comentas. ¿La idea de vender es porque piensas cambiarte, invertir en otra propiedad o simplemente estás explorando vender?';
  }

  if (!state.urgency_level && !state.timeline_text) {
    return '¿En qué tiempo te gustaría venderla? Esto ayuda a definir la estrategia comercial correcta.';
  }

  return 'Para darte un número responsable, revisamos cierres reales, comparables activos, absorción y posicionamiento de la zona. Más que solo publicar, lo importante es posicionarla bien y evitar sobreprecio para que no se quede detenida.\n\nLo ideal sería verla físicamente para darte una recomendación más precisa. Podemos agendar una visita rápida de 20 minutos. ¿Te queda mejor entre semana o fin de semana?';
}

async function buildFallbackOpenAIReply(text, state, changeType) {
  const consultantContext = buildPerseoConsultantContext(state, [], {
    userMessage: text,
    changeType,
    matchedPropertiesCount: 0,
  });

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [
      { role: 'system', content: PERSEO_CONSULTANT_SYSTEM_PROMPT },
      { role: 'system', content: consultantContext },
      {
        role: 'system',
        content: `Estado actual:
${safeJsonStringify(state)}

Tipo de cambio detectado: ${changeType}

IMPORTANTE:
- No compartas propiedades específicas.
- No inventes resultados.
- Máximo una pregunta.
- Mantén tono premium, natural y comercial.
- Si detectas interés, orienta a visita o asesor.
- Si existe referencia directa a propiedad, responde como seguimiento de esa propiedad.
- Habla del ID oficial si ya existe uno detectado.
- No suenes como bot.
`,
      },
      { role: 'user', content: text },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    '¿En qué puedo orientarte? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?'
  );
}

module.exports = {
  buildAiSummary,
  buildLowInfoCampaignReply,
  getChangeAcknowledgement,
  buildDemandLowValueReply,
  buildOfferRejectedReply,
  buildFinalHandoffReply,
  buildPropertyInterestReply,
  buildPropertyPriceReply,
  buildDirectPropertyReply,
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
};
