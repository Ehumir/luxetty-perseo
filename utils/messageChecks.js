const { normalizeText, cleanSpaces } = require('./text');

function isGreetingOnly(text) {
  const raw = cleanSpaces(String(text || ''));
  if (!raw) return false;
  const t = normalizeText(raw);
  const greetings = [
    'hola',
    'buenas',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'hello',
    'hi',
    'buen dia',
    'buen día',
  ];
  if (greetings.includes(t)) return true;
  // "Hola 👋 buenas tardes", "Hola buenas"
  if (/^(hola|hey|hi)(\s|$)/.test(t) && t.length < 48) {
    const rest = t.replace(/^(hola|hey|hi)\s*/, '');
    if (!rest) return true;
    if (
      /^(buenas|buenos dias|buenos días|buenas tardes|buenas noches|buen dia|buen día)[!?.]*$/.test(
        rest,
      )
    ) {
      return true;
    }
  }
  return false;
}

module.exports = {
  isGreetingOnly,
};
