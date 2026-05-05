const { normalizeText } = require('../utils/text');
const { normalizeAiState } = require('./aiState');
const { getNextStep } = require('./nextStep');
const { getPlaybookForIntent } = require('./playbooks');

function detectIntent(message, prevState = null) {
  const text = normalizeText(message);
  const prev = normalizeAiState(prevState);

  const wantsOfferRent =
    text.includes('poner en renta') ||
    text.includes('quiero poner en renta') ||
    text.includes('quiero rentar mi casa') ||
    text.includes('quiero rentar mi propiedad') ||
    text.includes('quiero rentar mi depa') ||
    text.includes('quiero rentar mi departamento') ||
    text.includes('rentar mi propiedad') ||
    text.includes('rento mi propiedad') ||
    text.includes('renta mi casa') ||
    text.includes('renta mi propiedad') ||
    text.includes('tengo una propiedad para renta') ||
    text.includes('tengo propiedad para renta') ||
    text.includes('busco inquilino');

  const wantsSell =
    text.includes('quiero vender') ||
    text.includes('vender') ||
    text.includes('vendo') ||
    text.includes('vender mi casa') ||
    text.includes('vender mi propiedad') ||
    text.includes('venta mi casa') ||
    text.includes('venta mi propiedad');

  const wantsSellerGeneric =
    text.includes('quiero vender una propiedad') ||
    text.includes('quiero informacion') ||
    text.includes('quiero información') ||
    text.includes('compran terrenos') ||
    text.includes('compras terrenos') ||
    text.includes('quiero vender casa') ||
    text.includes('tengo una propiedad') ||
    text.includes('necesito vender') ||
    text.includes('esta invadida') ||
    text.includes('está invadida') ||
    text.includes('tengo papeles') ||
    text.includes('la quiero vender barata') ||
    text.includes('tiene inquilino') ||
    text.includes('esta intestada') ||
    text.includes('está intestada') ||
    text.includes('esta en sucesion') ||
    text.includes('está en sucesión');

  const wantsRent =
    text.includes('quiero rentar') ||
    text.includes('busco renta') ||
    text.includes('busco casa de renta') ||
    text.includes('busco depa de renta') ||
    text.includes('busco departamento de renta') ||
    text.includes('busco casa en renta') ||
    text.includes('busco depa en renta') ||
    text.includes('busco departamento en renta') ||
    text.includes('casa en renta') ||
    text.includes('depa en renta') ||
    text.includes('departamento en renta') ||
    text.includes('tienen depas en renta') ||
    text.includes('tienen departamentos en renta') ||
    text.includes('quiero una renta') ||
    text.includes('rentar') ||
    text.includes('alquilar') ||
    text.includes('alquiler') ||
    text.includes('rentar una') ||
    text.includes('rentar un');

  const wantsBuy =
    text.includes('quiero comprar') ||
    text.includes('busco comprar') ||
    text.includes('busco casa') ||
    text.includes('busco depa') ||
    text.includes('busco departamento') ||
    text.includes('busco terreno') ||
    text.includes('tienes casas') ||
    text.includes('tienen casas') ||
    text.includes('tienes departamentos') ||
    text.includes('tienen departamentos') ||
    text.includes('tienes depas') ||
    text.includes('tienen depas') ||
    text.includes('comprar') ||
    text.includes('busco una propiedad');

  const implicitDemand =
    text.includes('tienes propiedades') ||
    text.includes('que propiedades tienes') ||
    text.includes('qué propiedades tienes') ||
    text.includes('que tienes') ||
    text.includes('qué tienes') ||
    text.includes('hay casas') ||
    text.includes('hay opciones') ||
    text.includes('manejas') ||
    text.includes('opciones') ||
    text.includes('disponibles') ||
    text.includes('me interesa esta propiedad') ||
    text.includes('me interesa esa propiedad') ||
    text.includes('vi la propiedad') ||
    text.includes('vi una propiedad') ||
    text.includes('vi la casa') ||
    text.includes('en cumbres') ||
    text.includes('en san pedro') ||
    text.includes('en monterrey') ||
    text.includes('en garcia') ||
    text.includes('en garcía') ||
    text.includes('que tipo de propiedades tienes') ||
    text.includes('qué tipo de propiedades tienes');

  const implicitOffer =
    text.includes('mi casa') ||
    text.includes('mi propiedad') ||
    text.includes('mi depa') ||
    text.includes('mi departamento') ||
    text.includes('quiero que me ayuden a vender') ||
    text.includes('quiero que me ayuden a rentar') ||
    text.includes('quiero publicar mi propiedad');

  const wantsHuman =
    text.includes('asesor') ||
    text.includes('agente') ||
    text.includes('persona') ||
    text.includes('humano') ||
    text.includes('marquen') ||
    text.includes('llamen') ||
    text.includes('llamada') ||
    text.includes('contactenme') ||
    text.includes('contáctenme') ||
    text.includes('contactarme');

  const propertyInterest =
    text.includes('me interesa esta propiedad') ||
    text.includes('me interesa esa propiedad') ||
    text.includes('me interesa la propiedad') ||
    text.includes('vi la propiedad') ||
    text.includes('vi una propiedad') ||
    text.includes('vi la casa') ||
    text.includes('quiero verla') ||
    text.includes('quiero verlo') ||
    text.includes('agendar visita') ||
    text.includes('agendar una visita') ||
    text.includes('quiero una cita');

  const hasPriceExpressions =
    text.includes('millones') ||
    text.includes('millon') ||
    text.includes('millón') ||
    text.endsWith('m') ||
    text.includes('$') ||
    /\b\d{4,8}\b/.test(text);

  let leadType = null;
  let operationType = null;

  if (wantsOfferRent) {
    leadType = 'offer';
    operationType = 'rent';
  } else if (wantsSell) {
    leadType = 'offer';
    operationType = 'sale';
  } else if (wantsRent) {
    leadType = 'demand';
    operationType = 'rent';
  } else if (wantsBuy) {
    leadType = 'demand';
    operationType = 'sale';
  } else if (wantsSellerGeneric) {
    leadType = 'offer';
    operationType = 'sale';
  }

  if (!leadType && implicitOffer) {
    leadType = 'offer';
  }

  if (!leadType && implicitDemand) {
    leadType = 'demand';
  }

  if (!leadType && hasPriceExpressions && (
    text.includes('casa') ||
    text.includes('casas') ||
    text.includes('depa') ||
    text.includes('departamento') ||
    text.includes('terreno') ||
    text.includes('propiedad')
  )) {
    leadType = 'demand';
  }

  if (!operationType) {
    if (leadType === 'demand' && hasPriceExpressions) {
      operationType = 'sale';
    } else if (leadType && prev.operation_type) {
      operationType = prev.operation_type;
    }
  }

  if (!operationType && text.includes('renta')) operationType = 'rent';
  if (!operationType && text.includes('venta')) operationType = 'sale';

  const intentName =
    propertyInterest
      ? 'property_interest'
      : leadType === 'offer'
      ? 'supply'
      : leadType || null;

  const intent = { type: intentName, intent: intentName, leadType, operationType, wantsHuman };
  intent.intent_changed = !!(prev.intent_type && intent.type && prev.intent_type !== intent.type);
  intent.next_step = getNextStep(intent, prev);
  intent.playbook = getPlaybookForIntent(intent);

  return intent;
}

module.exports = {
  detectIntent,
};
