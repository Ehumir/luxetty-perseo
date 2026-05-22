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

module.exports = {
  normalizeText,
  cleanSpaces,
  normalizeMultilineText,
};