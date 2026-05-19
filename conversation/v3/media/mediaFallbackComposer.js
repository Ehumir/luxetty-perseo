'use strict';

const { cleanSpaces } = require('../../../utils/text');

function composeAudioNoTranscriptFallback() {
  return cleanSpaces(
    'Recibí tu audio, pero no puedo escucharlo con claridad desde aquí. ¿Me lo confirmas por escrito en una frase (venta, renta, compra o visita)?',
  );
}

function composeAudioLowConfidenceFallback(transcript = '') {
  const snippet = cleanSpaces(transcript).slice(0, 80);
  const prefix = snippet
    ? `Entendí algo como: «${snippet}». `
    : '';
  return cleanSpaces(
    `${prefix}Para no asumir mal lo del audio, ¿me confirmas por escrito el dato principal?`,
  );
}

function composeImageIllegibleFallback() {
  return cleanSpaces(
    'Recibí la imagen, pero no la alcanzo a interpretar con claridad. ¿Me describes en texto qué quieres revisar (venta, renta, compra o una propiedad en particular)?',
  );
}

function composeImageHintsAcknowledgement(hints = []) {
  const labels = hints
    .map((h) => cleanSpaces(h?.hint || h?.type || ''))
    .filter(Boolean)
    .slice(0, 2);
  const hintText = labels.length ? ` Por lo visible podría ser ${labels.join(' / ')}.` : '';
  return cleanSpaces(
    `Gracias por la imagen.${hintText} Es solo una referencia visual — no confirmo precio, metros ni disponibilidad sin un asesor. ¿Buscas vender, rentar o comprar?`,
  );
}

module.exports = {
  composeAudioNoTranscriptFallback,
  composeAudioLowConfidenceFallback,
  composeImageIllegibleFallback,
  composeImageHintsAcknowledgement,
};
