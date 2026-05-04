const { normalizeText, cleanSpaces } = require('../utils/text');

const ACCEPTED_ZONE_HINT =
  'Monterrey, Cumbres, Garcia, San Pedro Garza Garcia, Carretera Nacional, Santa Catarina y zonas residenciales de alto valor en Guadalupe, San Nicolas y Apodaca';

const ACCEPTED_ZONES = [
  'monterrey',
  'cumbres',
  'garcia',
  'garcía',
  'san pedro',
  'san pedro garza garcia',
  'san pedro garza garcía',
  'carretera nacional',
  'santa catarina',
  'guadalupe',
  'san nicolas',
  'san nicolás',
  'apodaca',
];

const MIN_SALE_VALUE_MXN = 3000000;
const MIN_RENT_VALUE_MXN = 10000;

const PERSEO_CONSULTANT_SYSTEM_PROMPT = `
Eres PERSEO, asesor inmobiliario IA de Luxetty.

Objetivo:
- Filtrar, calificar, orientar y llevar a cita.
- Actuar como asesor consultivo y estrategico.
- No comportarte como formulario ni interrogatorio.

Reglas no negociables:
- Maximo 1 a 2 preguntas por mensaje.
- Tono profesional, natural, consultivo, estrategico, claro y amable.
- Usa micro-validaciones breves cuando aplique: "Perfecto", "Claro", "Entiendo", "Super valido".
- Evita sonar robotico, repetitivo o como checklist.
- No inventes propiedades, datos tecnicos, disponibilidad o precios.
- No recomiendes propiedades ni sitios externos.
- Solo usa links de https://luxetty.com.
- Nunca prometas precio, venta, renta, compradores ni resultados.
- Nunca envies resumen interno al prospecto.

Filtros de Luxetty:
- Zonas aceptadas: ${ACCEPTED_ZONE_HINT}.
- Minimo de venta/compra: $3,000,000 MXN.
- Minimo de renta: $10,000 MXN.

Flujo oferta (si quiere vender o rentar su propiedad):
- Confirmar: zona, precio, si es propietario, tipo de propiedad, caracteristicas, urgencia, si trabaja con inmobiliaria, exclusividad y disponibilidad para visita.

Flujo demanda (si quiere comprar o rentar):
- Confirmar: zona, presupuesto, tipo de propiedad, caracteristicas principales y disponibilidad para llamada o visita.

Manejo de precio:
- Nunca valides precio como definitivo.
- Explica que se requiere analisis comparativo con cierres reales y absorcion de la zona.
- Puedes usar frases consultivas como:
  - "Para darte un numero responsable..."
  - "Mas que solo publicar, lo importante es posicionarla bien."
  - "Para evitar sobreprecio y que se quede detenida, conviene revisar cierres reales."
  - "Lo ideal seria verla fisicamente para darte una recomendacion mas precisa."

Manejo de comision:
- Si preguntan por comision, responde exactamente:
"Normalmente manejamos entre 3.5% y 5%, dependiendo del tipo de propiedad y la estrategia de comercializacion.

Mas que el porcentaje, lo importante es que incluye el servicio y como se va a implementar."
- Despues pregunta si tiene exclusividad.

Cierre recomendado cuando hay datos suficientes:
- "Podemos agendar una visita rapida de 20 minutos." o
- "Podemos agendar una llamada breve de 20 minutos."
- Pregunta: "Te queda mejor entre semana o fin de semana?"
`.trim();

function hasCommissionQuestion(text) {
  const t = normalizeText(text || '');
  if (!t) return false;
  return (
    t.includes('comision') ||
    t.includes('comisión') ||
    t.includes('porcentaje') ||
    t.includes('cuanto cobran') ||
    t.includes('cuánto cobran')
  );
}

function isAcceptedZone(locationText) {
  const t = normalizeText(locationText || '');
  if (!t) return null;
  return ACCEPTED_ZONES.some((zone) => t.includes(normalizeText(zone)));
}

function formatRecentMessages(recentMessages = []) {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return 'Sin historial reciente.';
  }

  return recentMessages
    .slice(-8)
    .map((msg) => {
      const role = msg?.role || 'user';
      const content = cleanSpaces(msg?.content || '');
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function buildPerseoConsultantContext(aiState = {}, recentMessages = [], externalContext = {}) {
  const state = aiState && typeof aiState === 'object' ? aiState : {};
  const locationText = cleanSpaces(state.location_text || '');
  const leadFlow = state.lead_flow || null;
  const operationType = state.operation_type || null;
  const budgetMax = Number(state.budget_max || 0) || null;

  const zoneAccepted = isAcceptedZone(locationText);
  const isRentFlow = operationType === 'rent';
  const minRequired = isRentFlow ? MIN_RENT_VALUE_MXN : MIN_SALE_VALUE_MXN;
  const belowMinimum = budgetMax != null && budgetMax > 0 && budgetMax < minRequired;

  const latestUserText = cleanSpaces(
    externalContext.userMessage ||
      recentMessages
        .slice()
        .reverse()
        .find((m) => m?.role === 'user')?.content ||
      ''
  );

  const commissionQuestion = hasCommissionQuestion(latestUserText);

  const offerMissing = [
    !locationText && 'zona',
    budgetMax == null && 'precio',
    !state.owner_relation && 'si es propietario',
    !state.property_type && 'tipo de propiedad',
    (!state.must_have_features || state.must_have_features.length === 0) && 'caracteristicas',
    !state.urgency_level && 'urgencia',
    !state.works_with_realtor && 'si trabaja con inmobiliaria',
    !state.has_exclusivity && 'exclusividad',
    !state.availability_for_visit && 'disponibilidad para visita',
  ].filter(Boolean);

  const ownerCaptureSnapshot = [
    state.terrain_m2 != null ? `terreno_m2=${state.terrain_m2}` : null,
    state.construction_m2 != null ? `construccion_m2=${state.construction_m2}` : null,
    state.floors_count != null ? `plantas=${state.floors_count}` : null,
    state.bedrooms != null ? `recamaras=${state.bedrooms}` : null,
    state.bathrooms != null ? `banos=${state.bathrooms}` : null,
    state.occupancy_status ? `ocupacion=${state.occupancy_status}` : null,
    state.legal_deeded != null ? `escriturada=${state.legal_deeded ? 'si' : 'no'}` : null,
    state.has_mortgage != null ? `credito_hipotecario=${state.has_mortgage ? 'si' : 'no'}` : null,
    state.works_with_realtor != null ? `trabaja_con_inmobiliaria=${state.works_with_realtor ? 'si' : 'no'}` : null,
    state.exclusivity_type ? `exclusividad=${state.exclusivity_type}` : null,
    state.expected_price != null ? `precio_esperado=${state.expected_price}` : null,
  ].filter(Boolean);

  const demandMissing = [
    !locationText && 'zona',
    budgetMax == null && 'presupuesto',
    !state.property_type && 'tipo de propiedad',
    (!state.must_have_features || state.must_have_features.length === 0) && 'caracteristicas principales',
    !state.contact_preference && 'disponibilidad para llamada o visita',
  ].filter(Boolean);

  const guidance = [];

  if (!leadFlow) {
    guidance.push('Primero identifica si el prospecto quiere ofertar (vender/rentar su propiedad) o demandar (comprar/rentar).');
  }

  if (zoneAccepted === false) {
    guidance.push(
      `La zona parece fuera de cobertura. Explica con tacto el enfoque geografico de Luxetty y confirma si tiene opcion en estas zonas: ${ACCEPTED_ZONE_HINT}.`
    );
  }

  if (belowMinimum) {
    guidance.push(
      `El monto esta por debajo del minimo (${isRentFlow ? '$10,000 MXN renta' : '$3,000,000 MXN compra/venta'}). Explicalo con respeto y ofrece ajustar criterios o canalizar orientacion.`
    );
  }

  if (commissionQuestion) {
    guidance.push('Detectaste pregunta de comision: responde con el texto exacto de politicas y luego pregunta por exclusividad.');
  }

  if (state.asks_only_valuation) {
    guidance.push('Detectaste objecion de solo valuacion: explica comparables, cierres reales, competencia y absorcion antes de dar orientacion inicial.');
  }

  if (state.objection_higher_other_agency) {
    guidance.push('Detectaste comparacion con otra inmobiliaria: explica diferencia entre oferta publicada vs cierres reales y riesgo de sobreprecio.');
  }

  if (leadFlow === 'offer' && offerMissing.length > 0) {
    guidance.push(`Oferta en calificacion. Prioriza confirmar estos datos con maximo 1-2 preguntas: ${offerMissing.join(', ')}.`);
  }

  if (leadFlow === 'demand' && demandMissing.length > 0) {
    guidance.push(`Demanda en calificacion. Prioriza confirmar estos datos con maximo 1-2 preguntas: ${demandMissing.join(', ')}.`);
  }

  if (
    (leadFlow === 'offer' && offerMissing.length <= 2 && offerMissing.length > 0) ||
    (leadFlow === 'demand' && demandMissing.length <= 2 && demandMissing.length > 0)
  ) {
    guidance.push('Si ya casi completas datos, orienta a cierre consultivo con propuesta de llamada o visita de 20 minutos.');
  }

  if (
    (leadFlow === 'offer' && offerMissing.length === 0) ||
    (leadFlow === 'demand' && demandMissing.length === 0)
  ) {
    guidance.push(
      'Ya hay informacion suficiente para cierre: propone llamada o visita de 20 minutos y pregunta si le queda entre semana o fin de semana.'
    );
  }

  const locationCatalog = Array.isArray(externalContext.locationCatalog)
    ? externalContext.locationCatalog.join(', ')
    : '';

  return [
    'CONTEXTO_CONSULTIVO_PERSEO:',
    `lead_flow=${leadFlow || 'unknown'}`,
    `operation_type=${operationType || 'unknown'}`,
    `location_text=${locationText || 'unknown'}`,
    `zone_accepted=${zoneAccepted === null ? 'unknown' : zoneAccepted ? 'yes' : 'no'}`,
    `budget_max=${budgetMax == null ? 'unknown' : budgetMax}`,
    `minimum_required_mxn=${minRequired}`,
    `below_minimum=${belowMinimum ? 'yes' : 'no'}`,
    `change_type=${externalContext.changeType || 'unknown'}`,
    `matched_properties_count=${externalContext.matchedPropertiesCount ?? 0}`,
    ownerCaptureSnapshot.length ? `owner_capture_snapshot=${ownerCaptureSnapshot.join(', ')}` : null,
    locationCatalog ? `location_catalog=${locationCatalog}` : null,
    guidance.length ? `guidance=${guidance.join(' ')}` : 'guidance=Mantener avance consultivo y comercial sin sonar a formulario.',
    'historial_reciente:',
    formatRecentMessages(recentMessages),
    latestUserText ? `ultimo_mensaje_usuario=${latestUserText}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
};