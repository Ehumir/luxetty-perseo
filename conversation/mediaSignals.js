const { cleanSpaces, normalizeText } = require('../utils/text');

function detectImageCategory(rawText = '') {
  const text = normalizeText(rawText || '');
  if (!text) return 'unknown';

  if (
    text.includes('escritura') ||
    text.includes('predial') ||
    text.includes('documento') ||
    text.includes('titulo') ||
    text.includes('título') ||
    text.includes('ine') ||
    text.includes('boleta')
  ) {
    return 'document';
  }

  if (text.includes('terreno') || text.includes('lote') || text.includes('fraccionamiento')) {
    return 'land';
  }

  if (text.includes('casa') || text.includes('fachada') || text.includes('depa') || text.includes('departamento')) {
    return 'house';
  }

  return 'unknown';
}

function extractAudioTranscription(message = {}) {
  const options = [
    message?.audio?.transcription_text,
    message?.audio?.transcription?.text,
    message?.audio?.transcription,
    message?.audio?.text,
    message?.voice?.transcription,
    message?.voice?.text,
  ];

  for (const value of options) {
    const parsed = cleanSpaces(value || '');
    if (parsed) return parsed;
  }

  return null;
}

function extractMapUrl(text = '') {
  const raw = cleanSpaces(text || '');
  if (!raw) return null;
  const match = raw.match(/https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|maps\.google\.com|goo\.gl\/maps|waze\.com)\S*/i);
  return match?.[0] || null;
}

function extractInteractiveText(interactive = {}) {
  const buttonReply = interactive?.button_reply || null;
  if (buttonReply) {
    return cleanSpaces(buttonReply.title || buttonReply.id || '');
  }

  const listReply = interactive?.list_reply || null;
  if (listReply) {
    return cleanSpaces(listReply.title || listReply.description || listReply.id || '');
  }

  const nfmReply = interactive?.nfm_reply || null;
  if (nfmReply) {
    return cleanSpaces(nfmReply.body || nfmReply.response_json || nfmReply.name || '');
  }

  return cleanSpaces(interactive?.body || '');
}

function buildInboundMessageContext(message = {}) {
  const messageType = message?.type || null;
  const isForwarded =
    !!message?.context?.forwarded ||
    !!message?.context?.frequently_forwarded ||
    !!message?.forwarded;

  const media = {
    type: messageType,
    category: null,
    caption: null,
    file_name: null,
    mime_type: null,
    media_id: null,
    map_url: null,
    audio_without_transcription: false,
    audio_has_transcription: false,
    property_image_candidate: false,
    legal_or_property_document_candidate: false,
    attachment_detected_not_processed: false,
    unsupported_media: false,
    is_forwarded: isForwarded,
  };

  let messageText = '';
  let transcriptionText = null;

  if (messageType === 'text') {
    messageText = cleanSpaces(message?.text?.body || '');
    media.map_url = extractMapUrl(messageText);
    if (media.map_url) {
      media.category = 'location_link';
    }
  } else if (messageType === 'audio') {
    const transcript = extractAudioTranscription(message);
    const audioCaption = cleanSpaces(message?.audio?.caption || '');
    media.media_id = cleanSpaces(message?.audio?.id || '') || null;
    media.mime_type = cleanSpaces(message?.audio?.mime_type || '') || null;
    if (transcript) {
      media.audio_has_transcription = true;
      transcriptionText = transcript;
      messageText = audioCaption ? `${transcript}. ${audioCaption}` : transcript;
    } else {
      media.audio_without_transcription = true;
      media.attachment_detected_not_processed = true;
      messageText = 'El usuario envió un audio sin transcripción.';
    }
  } else if (messageType === 'voice') {
    const transcript = extractAudioTranscription(message);
    media.category = 'voice_note';
    media.media_id = cleanSpaces(message?.voice?.id || '') || null;
    media.mime_type = cleanSpaces(message?.voice?.mime_type || '') || null;
    if (transcript) {
      media.audio_has_transcription = true;
      transcriptionText = transcript;
      messageText = transcript;
    } else {
      media.audio_without_transcription = true;
      media.attachment_detected_not_processed = true;
      messageText = 'El usuario envió una nota de voz sin transcripción.';
    }
  } else if (messageType === 'image') {
    const caption = cleanSpaces(message?.image?.caption || '');
    media.caption = caption || null;
    media.category = detectImageCategory(caption);
    media.mime_type = cleanSpaces(message?.image?.mime_type || '');
    media.media_id = cleanSpaces(message?.image?.id || '') || null;
    media.property_image_candidate = media.category === 'land' || media.category === 'house' || media.category === 'unknown';
    media.legal_or_property_document_candidate = media.category === 'document';
    media.attachment_detected_not_processed = true;

    if (caption) {
      messageText = caption;
    } else {
      messageText = media.category === 'document'
        ? 'El usuario envió una imagen de documento de propiedad.'
        : media.category === 'land'
        ? 'El usuario envió una imagen de terreno.'
        : media.category === 'house'
        ? 'El usuario envió una imagen de casa.'
        : 'El usuario envió una imagen.';
    }
  } else if (messageType === 'document') {
    const caption = cleanSpaces(message?.document?.caption || '');
    const fileName = cleanSpaces(message?.document?.filename || '');
    const mimeType = cleanSpaces(message?.document?.mime_type || '');
    const mediaId = cleanSpaces(message?.document?.id || '');
    media.caption = caption || fileName || null;
    media.category = 'document';
    media.file_name = fileName || null;
    media.mime_type = mimeType || null;
    media.media_id = mediaId || null;
    media.map_url = extractMapUrl(caption || fileName || '');
    media.legal_or_property_document_candidate = true;
    media.attachment_detected_not_processed = true;
    messageText = caption || fileName || 'El usuario envió un documento relacionado con la propiedad.';
  } else if (messageType === 'location') {
    const latitude = message?.location?.latitude;
    const longitude = message?.location?.longitude;
    media.category = 'location_link';
    media.map_url =
      latitude != null && longitude != null
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : null;
    messageText = media.map_url
      ? `El usuario compartió una ubicación: ${media.map_url}`
      : 'El usuario compartió una ubicación.';
  } else if (messageType === 'video') {
    media.category = 'video';
    media.caption = cleanSpaces(message?.video?.caption || '') || null;
    media.mime_type = cleanSpaces(message?.video?.mime_type || '') || null;
    media.media_id = cleanSpaces(message?.video?.id || '') || null;
    media.attachment_detected_not_processed = true;
    messageText = media.caption || 'El usuario envió un video.';
  } else if (messageType === 'sticker') {
    media.category = 'sticker';
    media.media_id = cleanSpaces(message?.sticker?.id || '') || null;
    media.mime_type = cleanSpaces(message?.sticker?.mime_type || '') || null;
    media.attachment_detected_not_processed = true;
    messageText = 'El usuario envió un sticker.';
  } else if (messageType === 'contact') {
    media.category = 'contact';
    const firstContact = Array.isArray(message?.contacts) ? message.contacts[0] : message?.contact || null;
    const contactName = cleanSpaces(firstContact?.name?.formatted_name || firstContact?.name || '');
    const contactPhone = cleanSpaces(firstContact?.phones?.[0]?.phone || firstContact?.phone || '');
    messageText = contactName || contactPhone
      ? `El usuario compartió un contacto: ${contactName || 'sin nombre'} ${contactPhone || ''}`.trim()
      : 'El usuario compartió un contacto.';
  } else if (messageType === 'contacts') {
    media.category = 'contact';
    const firstContact = Array.isArray(message?.contacts) ? message.contacts[0] : null;
    const contactName = cleanSpaces(firstContact?.name?.formatted_name || firstContact?.name || '');
    const contactPhone = cleanSpaces(firstContact?.phones?.[0]?.phone || '');
    messageText = contactName || contactPhone
      ? `El usuario compartió contactos: ${contactName || 'sin nombre'} ${contactPhone || ''}`.trim()
      : 'El usuario compartió contactos.';
  } else if (messageType === 'button') {
    media.category = 'interactive';
    const buttonText = cleanSpaces(message?.button?.text || message?.button?.payload || '');
    messageText = buttonText || 'El usuario seleccionó una opción de botón.';
  } else if (messageType === 'interactive') {
    media.category = 'interactive';
    const interactiveText = extractInteractiveText(message?.interactive || {});
    messageText = interactiveText || 'El usuario seleccionó una opción interactiva.';
  } else if (messageType === 'unsupported' || messageType === 'unknown') {
    media.category = 'unsupported_media';
    media.unsupported_media = true;
    messageText = 'El usuario envió un archivo no compatible en este momento.';
  } else {
    media.category = 'unsupported_media';
    media.unsupported_media = true;
    media.attachment_detected_not_processed = messageType !== 'text';
    messageText = `El usuario envió un mensaje tipo ${messageType}.`;
  }

  return {
    messageType,
    messageText: cleanSpaces(messageText || ''),
    transcriptionText,
    media,
  };
}

function buildMediaAcknowledgementReply(media = {}) {
  if (media?.audio_without_transcription) {
    return 'Gracias, recibí tu audio. Para no interpretar mal la información, ¿me puedes escribir en una frase el punto principal? También puedo pedirle a un asesor que te contacte para revisarlo contigo.';
  }

  if (media?.type === 'image' || media?.type === 'document') {
    if (media?.ai_analysis?.ok && media.ai_analysis.summary) {
      return `Gracias, recibí la imagen y pude hacer una revisión automática preliminar. Detecté: ${media.ai_analysis.summary}. Para confirmar datos clave contigo y evitar suposiciones, ¿me compartes en texto lo principal que quieres lograr con esta propiedad?`;
    }

    if (media.category === 'document') {
      return 'Gracias, recibí el documento. Para manejarlo correctamente, no quiero darte una conclusión legal sin revisión. Lo ideal es que nuestro equipo lo revise y te diga qué ruta comercial conviene para vender la propiedad. ¿Te parece bien que un asesor te contacte para revisarlo?';
    }

    if (media.category === 'land') {
      return 'Gracias, recibí la imagen. Para poder orientarte mejor sin asumir algo incorrecto, ¿me confirmas si corresponde a terreno/lote? Si sí, ¿cuántos m² tiene y en qué fraccionamiento está?';
    }

    if (media.category === 'house') {
      return 'Gracias, recibí la imagen. Si corresponde a la propiedad, me ayuda como referencia, pero para no asumir detalles visuales necesito confirmar contigo: ¿está habitada actualmente y cuántos m² de terreno y construcción tiene?';
    }

    return 'Gracias, recibí la imagen. Para orientarte sin asumir información incorrecta, ¿me confirmas si es fachada, interior, documento o ubicación de la propiedad?';
  }

  if (media?.category === 'location_link') {
    return 'Gracias, recibí la ubicación. Con eso podemos ubicar mejor la zona. Para avanzar, ¿me confirmas si la propiedad está en venta, renta o estás buscando una valuación?';
  }

  if (media?.category === 'video') {
    return 'Gracias, recibí el video. Para ayudarte bien sin asumir detalles visuales, ¿me compartes en texto qué necesitas hacer con la propiedad y en qué zona está?';
  }

  if (media?.category === 'sticker' || media?.category === 'contact' || media?.unsupported_media) {
    return 'Recibí tu archivo/mensaje. Para poder ayudarte mejor, ¿me compartes en texto qué necesitas hacer con la propiedad?';
  }

  return null;
}

module.exports = {
  detectImageCategory,
  extractAudioTranscription,
  extractMapUrl,
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
};
