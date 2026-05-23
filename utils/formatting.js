const { getPublicPropertyUrl } = require('./helpers');

const PROPERTY_TYPE_LABELS_ES = {
  house: 'casa',
  home: 'casa',
  apartment: 'departamento',
  condo: 'departamento',
  land: 'terreno',
  terrain: 'terreno',
  lot: 'terreno',
  office: 'oficina',
  commercial: 'local comercial',
  warehouse: 'bodega',
  nave: 'bodega',
  local: 'local comercial',
  townhouse: 'casa',
  duplex: 'departamento',
};

/** Normaliza tipo interno (EN) → etiqueta español para outbound al cliente. */
function formatPropertyTypeLabel(propertyType) {
  const raw = String(propertyType ?? '').trim().toLowerCase();
  if (!raw || raw === 'null') return 'propiedad';
  if (PROPERTY_TYPE_LABELS_ES[raw]) return PROPERTY_TYPE_LABELS_ES[raw];
  if (/^(casa|departamento|terreno|oficina|local|bodega|inmueble|propiedad)$/.test(raw)) return raw;
  return 'inmueble';
}

/**
 * @deprecated Prefer sanitizeSpanishOutboundText from utils/text.js (sin dependencia circular).
 */
function sanitizeSpanishOutboundText(text) {
  const { sanitizeSpanishOutboundText: sanitize } = require('./text');
  return sanitize(text);
}

function formatMoney(amount, currencyCode = 'MXN') {
  if (amount == null) return 'Precio por confirmar';
  return `$${Number(amount).toLocaleString('es-MX')} ${currencyCode}`;
}

function formatOperationLabel(operationType) {
  if (operationType === 'sale') return 'compra';
  if (operationType === 'rent') return 'renta';
  return 'operación';
}

function formatPropertyShort(property) {
  const title = property.title || 'Propiedad disponible';
  const price = formatMoney(property.price, property.currency_code || 'MXN');
  const location =
    property.neighborhood ||
    property.zone ||
    property.city ||
    'Ubicación por confirmar';

  const extras = [];
  if (property.bedrooms != null) extras.push(`${property.bedrooms} recámaras`);
  if (property.bathrooms != null) extras.push(`${property.bathrooms} baños`);
  if (property.parking_spaces != null) extras.push(`${property.parking_spaces} cajones`);

  const publicUrl = getPublicPropertyUrl(property);

  let text = `• ${title}\n${price}\n${location}`;
  if (extras.length > 0) text += `\n${extras.join(' · ')}`;
  if (publicUrl) text += `\nVer galería y detalles: ${publicUrl}`;

  return text;
}

function formatPropertyList(properties) {
  return properties.map((p) => formatPropertyShort(p)).join('\n\n');
}

module.exports = {
  formatMoney,
  formatOperationLabel,
  formatPropertyTypeLabel,
  sanitizeSpanishOutboundText,
  formatPropertyShort,
  formatPropertyList,
};
