'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');

/**
 * Captación vendedor / valuación / publicación — patrones generales (sin zonas fijas).
 */
function matchesSellerAcquisitionPattern(normalizedText) {
  const t = String(normalizedText || '');
  return (
    /\b(?:quiero|necesito|busco)\s+(?:ayuda|apoyo)\s+(?:para\s+)?vender\b/.test(t) ||
    /\b(?:como|qué|que)\s+(?:me\s+)?(?:pueden|podr[ií]an|podrias|podrías)\s+ayudar(?:me)?\s+a\s+vender\b/.test(t) ||
    /\bquiero\s+vender\s+(?:mi\s+)?(?:casa|propiedad|depa|departamento|inmueble|terreno)\b/.test(t) ||
    /\b(?:poner|ponga|ponerla)\s+(?:en\s+)?venta\b/.test(t) ||
    /\bpublicar\s+(?:mi\s+)?(?:casa|propiedad|depa|departamento|inmueble)\b/.test(t) ||
    /\bvaluaci[oó]n\s+(?:de\s+)?(?:mi\s+)?(?:casa|propiedad|inmueble)\b/.test(t) ||
    /\bvaluar\s+(?:mi\s+)?(?:casa|propiedad|inmueble|terreno)\b/.test(t) ||
    /\b(?:captaci[oó]n|captacion)\s+(?:de\s+)?vendedor/i.test(t)
  );
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

function mentionsRentDemand(normalizedText) {
  const t = String(normalizedText || '');
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
  extractLooseLocationPhrase,
  isThinGenericInbound,
  mentionsRentDemand,
  isExplicitFlowSwitchToRentDemand,
  isExplicitFlowSwitchToRentOut,
  isExplicitFlowSwitchToSellFromRent,
  isExplicitPropertyInquiryPhrase,
};
