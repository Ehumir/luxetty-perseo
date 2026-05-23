function normalizeText(value) {
  if (value == null) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function cleanSpaces(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

/** Collapses horizontal whitespace per line; preserves line breaks for segmenters. */
function normalizeMultilineText(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line) => cleanSpaces(line))
    .filter(Boolean)
    .join('\n');
}

/** Evita términos EN en mensajes al cliente (p. ej. "tu land", "house"). */
function sanitizeSpanishOutboundText(text) {
  const input = String(text ?? '');
  if (!input.trim()) return input;

  let out = input;
  const replacements = [
    [/\bventa de tu land\b/gi, 'venta de tu terreno'],
    [/\bventa de tu house\b/gi, 'venta de tu casa'],
    [/\bde tu land\b/gi, 'de tu terreno'],
    [/\bde tu house\b/gi, 'de tu casa'],
    [/\btu land\b/gi, 'tu terreno'],
    [/\btu house\b/gi, 'tu casa'],
    [/\btu apartment\b/gi, 'tu departamento'],
    [/\btu home\b/gi, 'tu casa'],
    [/\bland\b/gi, 'terreno'],
    [/\bhouse\b/gi, 'casa'],
    [/\bapartment\b/gi, 'departamento'],
    [/\bhome\b/gi, 'casa'],
    [/\bwarehouse\b/gi, 'bodega'],
    [/\boffice\b/gi, 'oficina'],
    [/\bproperty listing\b/gi, 'propiedad'],
    [/\bproperty listings\b/gi, 'propiedades'],
  ];

  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }

  return out;
}

module.exports = {
  normalizeText,
  cleanSpaces,
  normalizeMultilineText,
  sanitizeSpanishOutboundText,
};