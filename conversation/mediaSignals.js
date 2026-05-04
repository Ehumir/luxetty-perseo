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

function mapAreaTypeToSpanish(areaType = null) {
  const mapping = {
    fachada: 'fachada',
    sala: 'sala',
    comedor: 'comedor',
    cocina: 'cocina',
    recamara: 'recamara',
    bano: 'bano',
    patio: 'patio',
    cochera: 'cochera',
    terraza: 'terraza',
    terreno: 'terreno',
    amenidad: 'amenidad',
    documento: 'documento',
  };

  return mapping[areaType] || null;
}

function mapPropertyTypeToSpanish(propertyType = null) {
  const mapping = {
    casa: 'casa',
    departamento: 'departamento',
    terreno: 'terreno',
    local: 'local comercial',
    oficina: 'oficina',
    bodega: 'bodega',
    interior: 'espacio interior',
    exterior: 'espacio exterior',
  };

  return mapping[propertyType] || null;
}

function buildImageVisionReply(media = {}) {
  const vision = media?.image_vision || null;

  if (!vision) return null;

  if (vision.ok) {
    const confidence = Number(vision?.propertySignals?.confidence ?? 0);
    const areaType = mapAreaTypeToSpanish(vision?.propertySignals?.visibleAreaType || null);
    const propertyType = mapPropertyTypeToSpanish(vision?.propertySignals?.probablePropertyType || null);
    const followUp = cleanSpaces(vision?.suggestedFollowUp || '');

    if (!areaType || confidence < 0.45) {
      return followUp
        ? `Gracias, ya pude revisar la imagen. No alcanzo a identificar con claridad suficiente la propiedad, pero puedo ayudarte igual. ${followUp}`
        : 'Gracias, ya pude revisar la imagen. No alcanzo a identificar con claridad suficiente la propiedad, pero puedo ayudarte igual. ¿Me confirmas si quieres venderla, rentarla o buscar una parecida?';
    }

    if (areaType === 'fachada' || areaType === 'exterior') {
      return `Gracias, ya pude revisar la imagen. Por lo visible, parece una ${areaType} de ${propertyType || 'propiedad'}. Para orientarte bien, necesito confirmar dos datos: ¿buscas venderla o rentarla, y en que colonia esta?`;
    }

    return `Gracias, ya revise la imagen. Se aprecia un ${areaType}${propertyType ? ` de ${propertyType}` : ''}, aparentemente en condicion habitable, aunque con una foto no puedo confirmar caracteristicas completas. ¿Esta propiedad la quieres vender, rentar o estas buscando algo similar?`;
  }

  if (vision.status === 'unsupported_mime') {
    return 'Recibi la imagen, pero este tipo de archivo no esta habilitado para analisis visual en este momento. Para ayudarte sin perder tiempo, ¿me confirmas si buscas venderla, rentarla o estas buscando una propiedad similar?';
  }

  return 'Recibi la imagen, pero no pude analizarla con suficiente claridad desde aqui. Para ayudarte sin perder tiempo, ¿me confirmas si buscas venderla, rentarla o estas buscando una propiedad similar?';
}

function buildImageVisionContextPrefix(media = {}, aiState = {}) {
  const vision = media?.image_vision || null;
  if (!vision?.ok) return null;

  if (aiState?.lead_flow === 'offer') {
    return 'Perfecto, esta imagen me ayuda como referencia de la propiedad que quieres vender o rentar.';
  }

  if (aiState?.lead_flow === 'demand') {
    return 'Perfecto, esta imagen me ayuda como referencia de la propiedad que estas buscando.';
  }

  return 'Perfecto, esta imagen me ayuda como referencia para orientarte mejor.';
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
    location_latitude: null,
    location_longitude: null,
    location_name: null,
    location_address: null,
    audio_without_transcription: false,
    audio_has_transcription: false,
    property_image_candidate: false,
    legal_or_property_document_candidate: false,
    image_vision_status: null,
    image_vision_success: false,
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
    const locationName = cleanSpaces(message?.location?.name || '');
    const locationAddress = cleanSpaces(message?.location?.address || '');
    media.category = 'location_link';
    media.location_latitude = latitude ?? null;
    media.location_longitude = longitude ?? null;
    media.location_name = locationName || null;
    media.location_address = locationAddress || null;
    media.map_url =
      latitude != null && longitude != null
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : null;
    if (locationName || locationAddress) {
      messageText = `El usuario compartió una ubicación: ${locationName || ''} ${locationAddress || ''}`.trim();
    } else {
      messageText = media.map_url
        ? `El usuario compartió una ubicación: ${media.map_url}`
        : 'El usuario compartió una ubicación.';
    }
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
  } else if (messageType === 'list_reply') {
    media.category = 'interactive';
    messageText = cleanSpaces(message?.list_reply?.title || message?.list_reply?.description || message?.list_reply?.id || '') || 'El usuario seleccionó una opción de lista.';
  } else if (messageType === 'button_reply') {
    media.category = 'interactive';
    messageText = cleanSpaces(message?.button_reply?.title || message?.button_reply?.id || '') || 'El usuario seleccionó una opción de botón.';
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

function resolveMediaContext(aiState = {}) {
  if (!aiState || typeof aiState !== 'object') {
    return { operationHint: null, zoneHint: '' };
  }

  const zone = cleanSpaces(aiState.location_text || '');
  const zoneHint = zone ? ` en ${zone}` : '';

  if (aiState.lead_flow === 'offer' && aiState.operation_type === 'sale') {
    return { operationHint: 'venta de tu propiedad', zoneHint };
  }

  if (aiState.lead_flow === 'offer' && aiState.operation_type === 'rent') {
    return { operationHint: 'renta de tu propiedad', zoneHint };
  }

  if (aiState.lead_flow === 'demand' && aiState.operation_type === 'sale') {
    return { operationHint: 'compra de propiedad', zoneHint };
  }

  if (aiState.lead_flow === 'demand' && aiState.operation_type === 'rent') {
    return { operationHint: 'busqueda de renta', zoneHint };
  }

  return { operationHint: null, zoneHint };
}

function buildMediaAcknowledgementReply(media = {}, options = {}) {
  const { operationHint, zoneHint } = resolveMediaContext(options?.aiState || {});

  if (media?.media_download_error) {
    if (operationHint) {
      return `Gracias, recibí tu archivo, pero hoy no pude descargarlo correctamente. Para no frenar la ${operationHint}${zoneHint}, ¿me lo puedes reenviar o resumir en texto el punto principal?`;
    }

    return 'Gracias, recibí tu archivo, pero hoy no pude descargarlo correctamente. ¿Me lo puedes reenviar o resumir en texto el punto principal para continuar sin retraso?';
  }

  if (media?.audio_without_transcription) {
    if (media?.audio_without_transcription_repeat) {
      return 'Gracias, sigo recibiendo tus audios, pero en este momento no estoy logrando transcribirlos con claridad. Para no atrasarte, ¿me confirmas en texto solo el dato clave (venta, renta, compra o visita) o prefieres que te contacte un asesor?';
    }

    return 'Gracias, recibí tu audio. Tuve un problema para transcribirlo completo y no quiero malinterpretarlo. ¿Me puedes compartir en una frase si buscas vender, rentar, comprar o agendar una visita? Si prefieres, también puedo pedir que un asesor te contacte.';
  }

  if (media?.type === 'image' || media?.type === 'document') {
    if (media.type === 'image' && media.image_vision) {
      const imageVisionReply = buildImageVisionReply(media);
      if (imageVisionReply) return imageVisionReply;
    }

    if (media.category === 'document') {
      return 'Gracias, recibí el documento. Por ahora lo puedo registrar como referencia, pero necesito que me confirmes por mensaje el punto principal para avanzar correctamente.';
    }

    if (media.category === 'land') {
      return 'Gracias, recibí la imagen. La voy a tomar como referencia, pero para orientarte bien necesito confirmar algunos datos de la propiedad. ¿Buscas venderla, rentarla o estás buscando una propiedad similar?';
    }

    if (media.category === 'house') {
      return 'Gracias, recibí la imagen. La voy a tomar como referencia, pero para orientarte bien necesito confirmar algunos datos de la propiedad. ¿Buscas venderla, rentarla o estás buscando una propiedad similar?';
    }

    return 'Gracias, recibí la imagen. La voy a tomar como referencia, pero para orientarte bien necesito confirmar algunos datos de la propiedad. ¿Buscas venderla, rentarla o estás buscando una propiedad similar?';
  }

  if (media?.category === 'location_link') {
    return 'Gracias, recibí la ubicación. Para orientarte mejor, ¿esa ubicación corresponde a la propiedad que quieres vender/rentar o a la zona donde estás buscando?';
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
  buildImageVisionContextPrefix,
};
