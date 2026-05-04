const { axios, WHATSAPP_TOKEN } = require('./whatsappService');

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

function getAuthHeaders() {
  if (!WHATSAPP_TOKEN) {
    const error = new Error('whatsapp_token_missing');
    error.code = 'whatsapp_token_missing';
    throw error;
  }

  return {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  };
}

function createServiceError(stage, err, fallbackMessage) {
  const status = Number(err?.response?.status || 0) || null;
  const responseData = err?.response?.data || null;
  const details = responseData?.error?.message || err?.message || fallbackMessage;
  const code = responseData?.error?.code || err?.code || null;

  return {
    stage,
    status,
    code,
    message: String(details || fallbackMessage),
    details: responseData,
  };
}

function getInboundMediaDescriptor(message = {}) {
  const type = message?.type || null;

  if (!type) {
    return {
      mediaType: null,
      mediaId: null,
      caption: null,
      fileName: null,
      mimeType: null,
      shouldDownload: false,
      reason: 'missing_message_type',
    };
  }

  if (type === 'image') {
    return {
      mediaType: type,
      mediaId: message?.image?.id || null,
      caption: message?.image?.caption || null,
      fileName: null,
      mimeType: message?.image?.mime_type || null,
      shouldDownload: true,
    };
  }

  if (type === 'audio') {
    return {
      mediaType: type,
      mediaId: message?.audio?.id || null,
      caption: message?.audio?.caption || null,
      fileName: null,
      mimeType: message?.audio?.mime_type || null,
      shouldDownload: true,
    };
  }

  if (type === 'voice') {
    return {
      mediaType: type,
      mediaId: message?.voice?.id || null,
      caption: null,
      fileName: null,
      mimeType: message?.voice?.mime_type || null,
      shouldDownload: true,
    };
  }

  if (type === 'video') {
    return {
      mediaType: type,
      mediaId: message?.video?.id || null,
      caption: message?.video?.caption || null,
      fileName: null,
      mimeType: message?.video?.mime_type || null,
      shouldDownload: true,
    };
  }

  if (type === 'document') {
    return {
      mediaType: type,
      mediaId: message?.document?.id || null,
      caption: message?.document?.caption || null,
      fileName: message?.document?.filename || null,
      mimeType: message?.document?.mime_type || null,
      shouldDownload: true,
    };
  }

  if (type === 'sticker') {
    return {
      mediaType: type,
      mediaId: message?.sticker?.id || null,
      caption: null,
      fileName: null,
      mimeType: message?.sticker?.mime_type || null,
      shouldDownload: true,
    };
  }

  return {
    mediaType: type,
    mediaId: null,
    caption: null,
    fileName: null,
    mimeType: null,
    shouldDownload: false,
    reason: 'not_downloadable_media_type',
  };
}

async function getWhatsAppMediaMetadata(mediaId, options = {}) {
  const timeout = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (!mediaId) {
    const error = new Error('whatsapp_media_id_missing');
    error.code = 'whatsapp_media_id_missing';
    throw error;
  }

  try {
    const response = await axios.get(`${GRAPH_BASE_URL}/${encodeURIComponent(mediaId)}`, {
      headers: getAuthHeaders(),
      timeout,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    return response.data || {};
  } catch (err) {
    const wrapped = new Error('whatsapp_media_metadata_failed');
    wrapped.code = 'whatsapp_media_metadata_failed';
    wrapped.context = createServiceError('metadata', err, 'Failed to fetch WhatsApp media metadata');
    throw wrapped;
  }
}

async function downloadWhatsAppMedia(mediaUrl, options = {}) {
  const timeout = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);

  if (!mediaUrl) {
    const error = new Error('whatsapp_media_url_missing');
    error.code = 'whatsapp_media_url_missing';
    throw error;
  }

  try {
    const response = await axios.get(mediaUrl, {
      headers: getAuthHeaders(),
      timeout,
      responseType: 'arraybuffer',
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const buffer = Buffer.from(response.data || []);

    return {
      buffer,
      byteLength: buffer.byteLength,
      mimeType: response.headers?.['content-type'] || null,
      contentLength: Number(response.headers?.['content-length'] || 0) || buffer.byteLength,
    };
  } catch (err) {
    const wrapped = new Error('whatsapp_media_download_failed');
    wrapped.code = 'whatsapp_media_download_failed';
    wrapped.context = createServiceError('download', err, 'Failed to download WhatsApp media');
    throw wrapped;
  }
}

async function resolveInboundMedia(message = {}, options = {}) {
  const descriptor = getInboundMediaDescriptor(message);

  if (!descriptor.shouldDownload) {
    return {
      ok: false,
      reason: descriptor.reason || 'media_not_downloadable',
      ...descriptor,
    };
  }

  if (!descriptor.mediaId) {
    return {
      ok: false,
      reason: 'media_id_missing',
      ...descriptor,
    };
  }

  try {
    const metadata = await getWhatsAppMediaMetadata(descriptor.mediaId, options);
    const mediaUrl = metadata?.url || null;

    if (!mediaUrl) {
      return {
        ok: false,
        reason: 'metadata_missing_media_url',
        ...descriptor,
        metadata,
      };
    }

    const download = await downloadWhatsAppMedia(mediaUrl, options);

    return {
      ok: true,
      reason: null,
      ...descriptor,
      metadata,
      download,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err?.code || 'resolve_media_failed',
      ...descriptor,
      error: err?.context || {
        stage: 'unknown',
        status: null,
        code: err?.code || null,
        message: err?.message || 'Unknown media resolution error',
        details: null,
      },
    };
  }
}

module.exports = {
  getWhatsAppMediaMetadata,
  downloadWhatsAppMedia,
  resolveInboundMedia,
  getInboundMediaDescriptor,
};
