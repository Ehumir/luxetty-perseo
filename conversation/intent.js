const { normalizeText } = require('../utils/text');
const { normalizeAiState } = require('./aiState');

function detectIntent(message, prevState = null) {
  const text = normalizeText(message);
  const prev = normalizeAiState(prevState);

  const wantsOfferRent =
    text.includes('poner en renta') ||
    text.includes('quiero poner en renta') ||
    text.includes('rentar mi propiedad') ||
    text.includes('rento mi propiedad') ||
    text.includes('renta mi casa') ||
    text.includes('renta mi propiedad');

  const wantsSell =
    text.includes('quiero vender') ||
    text.includes('vender') ||
    text.includes('vendo') ||
    text.includes('vender mi casa') ||
    text.includes('vender mi propiedad') ||
    text.includes('venta mi casa') ||
    text.includes('venta mi propiedad');

  const wantsRent =
    text.includes('quiero rentar') ||
    text.includes('busco renta') ||
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
    text.includes('comprar') ||
    text.includes('compra') ||
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

  const hasPriceExpressions =
    text.includes('millones') ||
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
  }

  if (!leadType && implicitOffer) {
    leadType = 'offer';
  }

  if (!leadType && implicitDemand) {
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

  return { leadType, operationType, wantsHuman };
}

module.exports = {
  detectIntent,
};