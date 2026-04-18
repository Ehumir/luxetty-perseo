const { getPublicPropertyUrl } = require('./helpers');
function formatMoney(amount, currencyCode = 'MXN') {
  if (amount == null) return 'Precio por confirmar';
  return `$${Number(amount).toLocaleString('es-MX')} ${currencyCode}`;
}

function formatOperationLabel(operationType) {
  if (operationType === 'sale') return 'compra';
  if (operationType === 'rent') return 'renta';
  return 'operación';
}

function formatPropertyTypeLabel(propertyType) {
  const labels = {
    house: 'casa',
    apartment: 'departamento',
    land: 'terreno',
    office: 'oficina',
    commercial: 'local comercial',
    warehouse: 'nave',
  };
  return labels[propertyType] || propertyType || 'propiedad';
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
  formatPropertyShort,
  formatPropertyList,
};