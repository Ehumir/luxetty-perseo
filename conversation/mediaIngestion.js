const { cleanSpaces } = require('../utils/text');

function sanitizeFilename(name = '') {
  const normalized = cleanSpaces(String(name || ''));
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

function getInteractiveMetadata(interactive = {}) {
  const interactiveType = cleanSpaces(interactive?.type || '') || null;

  const buttonReply = interactive?.button_reply || null;
  const listReply = interactive?.list_reply || null;

  return {
    interactive_type: interactiveType,
    button_reply_id: cleanSpaces(buttonReply?.id || '') || null,
    button_reply_title: cleanSpaces(buttonReply?.title || '') || null,
    list_reply_id: cleanSpaces(listReply?.id || '') || null,
    list_reply_title: cleanSpaces(listReply?.title || '') || null,
    list_reply_description: cleanSpaces(listReply?.description || '') || null,
  };
}

function extractInboundSignalText(message = {}) {
  const type = message?.type || null;

  if (type === 'text') return cleanSpaces(message?.text?.body || '');
  if (type === 'image') return cleanSpaces(message?.image?.caption || '');
  if (type === 'document') {
    return cleanSpaces(message?.document?.caption || message?.document?.filename || '');
  }
  if (type === 'video') return cleanSpaces(message?.video?.caption || '');

  if (type === 'button') {
    return cleanSpaces(message?.button?.text || message?.button?.payload || '');
  }

  if (type === 'interactive') {
    const buttonTitle = cleanSpaces(message?.interactive?.button_reply?.title || '');
    if (buttonTitle) return buttonTitle;

    const listTitle = cleanSpaces(message?.interactive?.list_reply?.title || '');
    if (listTitle) return listTitle;

    return cleanSpaces(
      message?.interactive?.list_reply?.description ||
      message?.interactive?.button_reply?.id ||
      message?.interactive?.list_reply?.id ||
      ''
    );
  }

  if (type === 'location') {
    const loc = message?.location || {};
    const parts = [
      cleanSpaces(loc?.name || ''),
      cleanSpaces(loc?.address || ''),
      loc?.latitude != null && loc?.longitude != null ? `${loc.latitude},${loc.longitude}` : '',
    ].filter(Boolean);

    return parts.join(' | ');
  }

  return '';
}

function extractInboundMediaMetadata(message = {}, context = {}) {
  const mediaType = message?.type || null;
  const location = message?.location || null;
  const interactive = message?.interactive || null;

  const image = message?.image || null;
  const audio = message?.audio || null;
  const voice = message?.voice || null;
  const document = message?.document || null;
  const video = message?.video || null;
  const sticker = message?.sticker || null;

  const mediaObject = image || audio || voice || document || video || sticker || null;
  const rawMediaObject = mediaObject ? { ...mediaObject } : null;

  return {
    whatsapp_message_id: cleanSpaces(message?.id || '') || null,
    from: cleanSpaces(message?.from || context?.from || '') || null,
    timestamp: cleanSpaces(message?.timestamp || '') || null,
    type: mediaType,
    media_id: cleanSpaces(mediaObject?.id || '') || null,
    mime_type: cleanSpaces(mediaObject?.mime_type || '') || null,
    sha256: cleanSpaces(mediaObject?.sha256 || '') || null,
    caption: cleanSpaces(image?.caption || document?.caption || video?.caption || audio?.caption || '') || null,
    filename: sanitizeFilename(document?.filename || null),
    file_size: Number(mediaObject?.file_size || mediaObject?.size || 0) || null,
    voice: mediaType === 'audio' ? !!audio?.voice : mediaType === 'voice',
    download_status: 'received',
    location: location
      ? {
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          name: cleanSpaces(location?.name || '') || null,
          address: cleanSpaces(location?.address || '') || null,
        }
      : null,
    interactive: interactive ? getInteractiveMetadata(interactive) : null,
    raw_media_object: rawMediaObject,
    raw_message_min: {
      id: message?.id || null,
      from: message?.from || null,
      timestamp: message?.timestamp || null,
      type: mediaType,
      text: message?.text?.body || null,
      image: image ? { ...image } : null,
      audio: audio ? { ...audio } : null,
      voice: voice ? { ...voice } : null,
      document: document ? { ...document } : null,
      video: video ? { ...video } : null,
      sticker: sticker ? { ...sticker } : null,
      location: location ? { ...location } : null,
      interactive: interactive ? { ...interactive } : null,
      button: message?.button ? { ...message.button } : null,
      contacts: Array.isArray(message?.contacts) ? message.contacts : null,
      referral: message?.referral || message?.context?.referral || null,
    },
    conversation_id: context?.conversationId || null,
    contact_from: cleanSpaces(context?.from || '') || null,
  };
}

module.exports = {
  extractInboundMediaMetadata,
  extractInboundSignalText,
  sanitizeFilename,
};
