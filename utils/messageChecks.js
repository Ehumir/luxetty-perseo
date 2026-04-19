function isGreetingOnly(text) {
  const t = normalizeText(text);
  const greetings = [
    'hola',
    'buenas',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'hello',
    'hi',
  ];
  return greetings.includes(t);
}

module.exports = {
  isGreetingOnly
};