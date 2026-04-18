function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function cleanSpaces(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  normalizeText,
  cleanSpaces,
};