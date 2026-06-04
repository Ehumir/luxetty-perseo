'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');

function isLuxettyAdvisorOwnerLead(normalizedText) {
  const t = String(normalizedText || '');
  return (
    /\bluxetty\b/.test(t) ||
    /\b(?:asesor|me contacte|me contacten|contacte un asesor|contacten un asesor)\b/.test(t)
  );
}

/**
 * Captación vendedor / valuación / publicación — patrones generales (sin zonas fijas).
 * Incluye variantes C2 retargeting (WhatsApp prefill editable).
 */
function matchesSellerAcquisitionPattern(normalizedText) {
  const t = String(normalizedText || '');
  if (/\bbusco\s+rentar\b/.test(t) || (/\bquiero\s+comprar\b/.test(t) && !/\bvender\b/.test(t))) {
    return false;
  }
  if (
    t.includes('me interesa') &&
    t.includes('propiedad') &&
    (t.includes('anunci') || t.includes('anuncio') || t.includes('vi '))
  ) {
    return false;
  }
  return (
    /\b(?:quiero|necesito|busco)\s+(?:ayuda|apoyo)\s+(?:para\s+)?vender\b/.test(t) ||
    /\b(?:como|qué|que)\s+(?:me\s+)?(?:pueden|podr[ií]an|podrias|podrías)\s+ayudar(?:me)?\s+a\s+vender\b/.test(t) ||
    /\bquiero\s+vender\s+(?:mi\s+)?(?:casa|propiedad|depa|departamento|inmueble|terreno)\b/.test(t) ||
    /\bponer\s+en\s+renta\b/.test(t) ||
    /\b(?:poner|ponga|ponerla)\s+(?:en\s+)?venta\b/.test(t) ||
    /\bpublicar\s+(?:mi\s+)?(?:casa|propiedad|depa|departamento|inmueble)\b/.test(t) ||
    /\bvaluaci[oó]n\s+(?:de\s+)?(?:mi\s+)?(?:casa|propiedad|inmueble)\b/.test(t) ||
    /\bvaluar\s+(?:mi\s+)?(?:casa|propiedad|inmueble|terreno)\b/.test(t) ||
    /\b(?:valorar|valuar)\s+(?:mi\s+)?(?:casa|propiedad|inmueble|terreno)\b/.test(t) ||
    /\b(?:cu[aá]nto\s+vale|saber\s+cu[aá]nto\s+vale|conocer\s+el\s+valor)\s+(?:de\s+)?(?:mi\s+)?(?:casa|propiedad|inmueble)\b/.test(t) ||
    /\b(?:captaci[oó]n|captacion)\s+(?:de\s+)?vendedor/i.test(t) ||
    /\b(?:estoy\s+)?(?:pensando|considerando)\s+(?:vender|rentar)\b/.test(t) ||
    /\b(?:estoy\s+)?(?:pensando|considerando)\s+vender\b/.test(t) ||
    /\bvender\s+o\s+rentar\s+mi\s+propiedad\b/.test(t) ||
    (/\bquiero\s+que\s+(?:me\s+)?contacte\s+(?:un\s+)?asesor\b/.test(t) &&
      /\b(?:vender|venta|valorar|valuar|valuaci|rentar|renta|pensando|considerando|mi\s+(?:casa|propiedad)|poner en)\b/.test(t) &&
      !/\b(?:revisar|referencia|disponible|visita|anunci)\b/.test(t)) ||
    (/\b(?:me\s+)?interesa\s+que\s+(?:un\s+)?asesor\s+me\s+contacte\b/.test(t) &&
      /\b(?:valor|valuar|valorar|vender|venta|mi\s+casa|mi\s+propiedad)\b/.test(t)) ||
    (/\b(?:me\s+)?gustar[ií]a\s+valorar(?:la|lo)?\b/.test(t) &&
      /\b(?:propiedad|casa|vender|inmueble)\b/.test(t)) ||
    (isLuxettyAdvisorOwnerLead(t) &&
      /\b(?:vender|venta|valorar|valuar|valuaci|rentar|renta|pensando|considerando|poner en)\b/.test(t) &&
      !/\bbusco\b/.test(t) &&
      !/\b(?:revisar|referencia|disponible|visita|anunci)\b/.test(t))
  );
}

/** C2 / retargeting: mensaje con marca Luxetty o pedido explícito de asesor humano. */
function isC2SellerRetargetingEntry(text) {
  const t = normalizeText(String(text || ''));
  if (!matchesSellerAcquisitionPattern(t) && !isAmbiguousOwnerPropertyOrientation(text)) return false;
  return (
    /\bluxetty\b/.test(t) ||
    /\bquiero\s+que\s+(?:me\s+)?contacte\s+(?:un\s+)?asesor\b/.test(t) ||
    /\b(?:estoy\s+)?(?:pensando|considerando)\s+(?:vender|rentar)\b/.test(t) ||
    /\b(?:me\s+)?interesa\s+que\s+(?:un\s+)?asesor\s+me\s+contacte\b/.test(t)
  );
}

function isAmbiguousOwnerPropertyOrientation(text) {
  const t = normalizeText(String(text || ''));
  return (
    /\borientaci[oó]n\s+sobre\s+(?:mi\s+)?propiedad\b/.test(t) &&
    !/\b(?:vender|rentar|valorar|valuar|venta|renta|poner en)\b/.test(t)
  );
}

/** sale | rent | mixed | null */
function inferOwnerOfferOperation(normalizedText) {
  const t = String(normalizedText || '');
  const rentOut = isRentOutOwnerPhrase(t);
  const sellSignals =
    /\b(?:vender|venta|valorar|valuar|valuaci|cu[aá]nto\s+vale|conocer\s+el\s+valor)\b/.test(t);
  const rentSignals =
    rentOut ||
    (/\b(?:rentar|renta|arrendar|poner en renta)\b/.test(t) &&
      /\b(?:mi\s+)?(?:casa|propiedad|inmueble|depa)\b/.test(t));
  if (sellSignals && rentSignals) return 'mixed';
  if (rentSignals) return 'rent';
  if (sellSignals) return 'sale';
  return null;
}

/** Zona libre tras patrones de venta / ubicación ("en San Pedro", "de Cumbres"). */
function extractLooseLocationPhrase(text) {
  const t = normalizeText(text);
  const m = t.match(
    /\b(?:en|de)\s+([a-záéíóúñ0-9][a-záéíóúñ0-9\s,.-]{1,55}?)(?=\s*(?:\.|,|\?|!|$|\n)|\s+(?:me|mi|un|una|el|la|los|las|por|para|con|que|qué)\b)/i
  );
  if (!m) return null;
  const loc = cleanSpaces(m[1].replace(/[,]+$/g, ''));
  if (!loc || loc.length < 2) return null;
  if (/^(venta|renta|casa|propiedad|depa|departamento|terreno|lujo|info)$/i.test(loc)) return null;
  const titled = loc
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
  return titled.length > 60 ? `${titled.slice(0, 57)}...` : titled;
}

function isThinGenericInbound(normalizedText) {
  const t = cleanSpaces(String(normalizedText || ''));
  if (!t || t.length > 40) return false;
  return /^(info|informaci[oó]n|informacion|precio|precios|disponible\??|hola\??|buenas|hey|me interesa|interesa|disponibilidad\??)$/i.test(
    t
  );
}

function isRentOutOwnerPhrase(normalizedText) {
  const t = String(normalizedText || '');
  if (
    /\b(?:estoy\s+)?(?:pensando|considerando)\s+rentar\b/.test(t) &&
    (/\b(?:mi\s+)?(?:propiedad|casa|inmueble)\b/.test(t) || isLuxettyAdvisorOwnerLead(t))
  ) {
    return true;
  }
  if (
    isLuxettyAdvisorOwnerLead(t) &&
    /\b(?:quiero|necesito)\s+rentar\b/.test(t) &&
    /\b(?:propiedad|casa|inmueble)\b/.test(t) &&
    !/\bbusco\b/.test(t)
  ) {
    return true;
  }
  return (
    (/\b(?:quiero|necesito)\s+rentar\b/.test(t) &&
      /\b(?:que\s+tengo|mi\s+casa|mi\s+depa|mi\s+departamento|mi\s+propiedad|una\s+casa\s+que)\b/.test(t)) ||
    /\bponer\s+en\s+renta\b/.test(t) ||
    /\brentar\s+mi\b/.test(t) ||
    (/\brenta\b/.test(t) &&
      (/\bmi\s+casa\b/.test(t) || /\bmi\s+departamento\b/.test(t) || /\bmi\s+propiedad\b/.test(t)))
  );
}

function mentionsRentDemand(normalizedText) {
  const t = String(normalizedText || '');
  if (isRentOutOwnerPhrase(t)) return false;
  if (
    isLuxettyAdvisorOwnerLead(t) &&
    /\b(?:pensando|considerando|quiero|necesito)\s+rentar\b/.test(t) &&
    !/\bbusco\b/.test(t)
  ) {
    return false;
  }
  if (/\b(?:poner|ponerla|rentar\s+mi|mi\s+casa\s+en\s+renta)\b/.test(t) && /\b(?:renta|rentar)\b/.test(t)) {
    return false;
  }
  return (
    /\b(?:quiero|busco|necesito)\s+rentar\b/.test(t) ||
    /\brentar\s+(?:una|un|la|el)\b/.test(t) ||
    (/\brenta\b/.test(t) && /\b(?:busco|quiero|interesa)\b/.test(t))
  );
}

function isExplicitFlowSwitchToRentDemand(text) {
  const t = normalizeText(text);
  return (
    t.includes('mejor quiero rentar') ||
    t.includes('mejor busco rentar') ||
    t.includes('cambio a renta') ||
    t.includes('quiero rentarla') ||
    t.includes('busco rentar') ||
    (t.includes('arrendar') && t.includes('quiero'))
  );
}

function isExplicitFlowSwitchToRentOut(text) {
  const t = normalizeText(text);
  return (
    t.includes('mejor la pongo en renta') ||
    t.includes('ponerla en renta') ||
    t.includes('quiero ponerla en renta') ||
    t.includes('rentarla en lugar de vender') ||
    t.includes('cambio de planes') && t.includes('renta')
  );
}

function isExplicitFlowSwitchToSellFromRent(text) {
  const t = normalizeText(text);
  return (
    t.includes('mejor quiero vender') ||
    t.includes('cambio a venta') ||
    t.includes('quiero venderla') ||
    t.includes('en realidad quiero vender') ||
    t.includes('no quiero rentar') && t.includes('vender')
  );
}

function isExplicitPropertyInquiryPhrase(text) {
  const t = normalizeText(text);
  return (
    /\bme interesa\s+(?:la\s+)?(?:propiedad|casa|depa|departamento|inmueble)\b/.test(t) ||
    /\b(?:informaci[oó]n|info)\s+(?:de|sobre)\s+(?:la\s+)?(?:propiedad|casa|depa|inmueble|codigo|código)\b/.test(t) ||
    /\b(?:precio|disponible|sigue disponible|aun disponible|aún disponible|todav[ií]a disponible)\b/.test(t) ||
    /\b(?:quiero|me gustar[ií]a)\s+ver\s+(?:la\s+)?(?:casa|propiedad|depa)\b/.test(t)
  );
}

module.exports = {
  matchesSellerAcquisitionPattern,
  isC2SellerRetargetingEntry,
  isAmbiguousOwnerPropertyOrientation,
  inferOwnerOfferOperation,
  isLuxettyAdvisorOwnerLead,
  extractLooseLocationPhrase,
  isThinGenericInbound,
  mentionsRentDemand,
  isRentOutOwnerPhrase,
  isExplicitFlowSwitchToRentDemand,
  isExplicitFlowSwitchToRentOut,
  isExplicitFlowSwitchToSellFromRent,
  isExplicitPropertyInquiryPhrase,
};
