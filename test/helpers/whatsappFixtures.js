function buildWebhookEnvelope(messages = [], options = {}) {
  const phoneNumberId = options.phoneNumberId || '1234567890';

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: options.wabaId || 'waba-test-id',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: options.displayPhoneNumber || '5218110000000',
                phone_number_id: phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: options.profileName || 'Cliente QA' },
                  wa_id: options.waId || '5218111111111',
                },
              ],
              messages,
            },
          },
        ],
      },
    ],
  };
}

function baseMessage(overrides = {}) {
  return {
    from: overrides.from || '5218111111111',
    id: overrides.id || 'wamid.TEST.001',
    timestamp: overrides.timestamp || '1710000000',
    ...overrides,
  };
}

function textMessage(body, overrides = {}) {
  return baseMessage({
    type: 'text',
    text: { body },
    ...overrides,
  });
}

function imageMessage({ id = 'media-img-1', caption = '', mime_type = 'image/jpeg' } = {}, overrides = {}) {
  return baseMessage({
    type: 'image',
    image: {
      id,
      caption,
      mime_type,
    },
    ...overrides,
  });
}

function audioMessage({ id = 'media-aud-1', caption = '', mime_type = 'audio/ogg', transcription_text } = {}, overrides = {}) {
  const audio = { id, caption, mime_type };
  if (transcription_text) audio.transcription_text = transcription_text;

  return baseMessage({
    type: 'audio',
    audio,
    ...overrides,
  });
}

function voiceMessage({ id = 'media-voc-1', mime_type = 'audio/ogg' } = {}, overrides = {}) {
  return baseMessage({
    type: 'voice',
    voice: {
      id,
      mime_type,
    },
    ...overrides,
  });
}

function documentMessage({ id = 'media-doc-1', filename = 'documento.pdf', caption = '', mime_type = 'application/pdf' } = {}, overrides = {}) {
  return baseMessage({
    type: 'document',
    document: {
      id,
      filename,
      caption,
      mime_type,
    },
    ...overrides,
  });
}

function videoMessage({ id = 'media-vid-1', caption = '', mime_type = 'video/mp4' } = {}, overrides = {}) {
  return baseMessage({
    type: 'video',
    video: {
      id,
      caption,
      mime_type,
    },
    ...overrides,
  });
}

function stickerMessage({ id = 'media-stk-1', mime_type = 'image/webp' } = {}, overrides = {}) {
  return baseMessage({
    type: 'sticker',
    sticker: {
      id,
      mime_type,
    },
    ...overrides,
  });
}

function interactiveButtonMessage({ id = 'btn-id-1', title = 'Quiero visita' } = {}, overrides = {}) {
  return baseMessage({
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: {
        id,
        title,
      },
    },
    ...overrides,
  });
}

function interactiveListMessage({ id = 'list-id-1', title = 'Ver rentas', description = 'Opciones en renta' } = {}, overrides = {}) {
  return baseMessage({
    type: 'interactive',
    interactive: {
      type: 'list_reply',
      list_reply: {
        id,
        title,
        description,
      },
    },
    ...overrides,
  });
}

function buttonMessage({ payload = 'asesor_humano', text = 'Hablar con asesor' } = {}, overrides = {}) {
  return baseMessage({
    type: 'button',
    button: {
      payload,
      text,
    },
    ...overrides,
  });
}

function contactsMessage({ formattedName = 'Mariana Torres', phone = '5218122222222' } = {}, overrides = {}) {
  return baseMessage({
    type: 'contacts',
    contacts: [
      {
        name: {
          formatted_name: formattedName,
        },
        phones: [
          {
            phone,
          },
        ],
      },
    ],
    ...overrides,
  });
}

function referralTextMessage(body, referral = {}, overrides = {}) {
  return baseMessage({
    type: 'text',
    text: { body },
    referral,
    ...overrides,
  });
}

module.exports = {
  buildWebhookEnvelope,
  textMessage,
  imageMessage,
  audioMessage,
  voiceMessage,
  documentMessage,
  videoMessage,
  stickerMessage,
  interactiveButtonMessage,
  interactiveListMessage,
  buttonMessage,
  contactsMessage,
  referralTextMessage,
};
