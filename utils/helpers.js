// utils/helpers.js

function normalizePhoneNumber(input) {
  if (input == null) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');

  if (!digits) return null;

  // Caso MX local: 10 dígitos → WhatsApp México con prefijo 521.
  if (digits.length === 10) {
    return `521${digits}`;
  }

  // Caso MX sin indicador WhatsApp: 52 + 10 dígitos → 521 + 10 dígitos.
  if (digits.length === 12 && digits.startsWith('52')) {
    return `521${digits.slice(2)}`;
  }

  // Caso MX WhatsApp ya normalizado.
  if (digits.length === 13 && digits.startsWith('521')) {
    return digits;
  }

  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function normalizeWhatsApp(input) {
  return normalizePhoneNumber(input);
}

function normalizeName(input) {
  if (input == null) return null;

  const cleaned = String(input).trim().replace(/\s+/g, ' ');
  return cleaned || null;
}

function extractFirstName(fullName) {
  const normalized = normalizeName(fullName);
  if (!normalized) return null;

  const parts = normalized.split(' ').filter(Boolean);
  return parts.length ? parts[0] : null;
}

function isUuid(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanObject(obj = {}) {
  const cleaned = { ...obj };

  Object.keys(cleaned).forEach((key) => {
    if (cleaned[key] === undefined || cleaned[key] === null) {
      delete cleaned[key];
    }

    if (typeof cleaned[key] === 'string' && cleaned[key].trim() === '') {
      delete cleaned[key];
    }
  });

  return cleaned;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readFirstNonEmptyString(candidates) {
  for (const value of candidates) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function extractWhatsAppReferral(message) {
  if (!isPlainObject(message)) return null;

  const referral = isPlainObject(message.referral)
    ? message.referral
    : isPlainObject(message.context?.referral)
    ? message.context.referral
    : null;

  if (!referral) return null;

  const adObj = isPlainObject(referral.ad) ? referral.ad : {};
  const campaignObj = isPlainObject(referral.campaign) ? referral.campaign : {};

  const normalized = cleanObject({
    source_url: readFirstNonEmptyString([
      referral.source_url,
      referral.sourceUrl,
      referral.url,
      referral.link,
    ]),
    source_type: readFirstNonEmptyString([
      referral.source_type,
      referral.sourceType,
      referral.type,
    ]),
    source_id: readFirstNonEmptyString([
      referral.source_id,
      referral.sourceId,
      referral.id,
    ]),
    headline: readFirstNonEmptyString([
      referral.headline,
      referral.title,
    ]),
    body: readFirstNonEmptyString([
      referral.body,
      referral.text,
      referral.description,
    ]),
    media_type: readFirstNonEmptyString([
      referral.media_type,
      referral.mediaType,
    ]),
    image_url: readFirstNonEmptyString([
      referral.image_url,
      referral.imageUrl,
      referral.image?.url,
      referral.image?.link,
    ]),
    video_url: readFirstNonEmptyString([
      referral.video_url,
      referral.videoUrl,
      referral.video?.url,
      referral.video?.link,
    ]),
    thumbnail_url: readFirstNonEmptyString([
      referral.thumbnail_url,
      referral.thumbnailUrl,
      referral.thumbnail?.url,
      referral.thumb_url,
      referral.thumbUrl,
    ]),
    ctwa_clid: readFirstNonEmptyString([
      referral.ctwa_clid,
      referral.ctwaClid,
      referral.clid,
    ]),
    ad_id: readFirstNonEmptyString([
      referral.ad_id,
      referral.adId,
      adObj.id,
    ]),
    ad_name: readFirstNonEmptyString([
      referral.ad_name,
      referral.adName,
      adObj.name,
    ]),
    campaign_id: readFirstNonEmptyString([
      referral.campaign_id,
      referral.campaignId,
      campaignObj.id,
    ]),
    campaign_name: readFirstNonEmptyString([
      referral.campaign_name,
      referral.campaignName,
      campaignObj.name,
    ]),
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function findContactByWhatsApp(supabase, whatsapp) {
  try {
    const normalized = normalizeWhatsApp(whatsapp);
    if (!normalized) {
      return { ok: false, error: 'WhatsApp inválido' };
    }

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('whatsapp', normalized)
      .maybeSingle();

    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      found: !!data,
      contact: data || null
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function createContactFromConversation(supabase, payload = {}) {
  try {
    const fullName = normalizeName(payload.fullName);
    const whatsapp = normalizeWhatsApp(payload.whatsapp);

    if (!fullName) {
      return { ok: false, error: 'Nombre requerido' };
    }

    if (!whatsapp) {
      return { ok: false, error: 'WhatsApp requerido' };
    }

    const insertData = cleanObject({
      full_name: fullName,
      first_name: extractFirstName(fullName),
      whatsapp: whatsapp,
      notes_summary: normalizeName(payload.notesSummary) || undefined,
      created_by: isUuid(payload.createdBy) ? payload.createdBy : undefined
    });

    const { data, error } = await supabase
      .from('contacts')
      .insert(insertData)
      .select('*')
      .single();

    if (error) return { ok: false, error: error.message };

    return { ok: true, contact: data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function findOrCreateContact(supabase, phone, fullName = null) {
  try {
    const normalizedPhone = normalizeWhatsApp(phone);
    if (!normalizedPhone) {
      return { ok: false, error: 'WhatsApp inválido' };
    }

    const found = await findContactByWhatsApp(supabase, normalizedPhone);
    if (!found.ok) return found;

    if (found.found) {
      const contact = found.contact;
      if (fullName && !contact.full_name) {
        const updatedName = normalizeName(fullName);
        if (updatedName) {
          const { data, error } = await supabase
            .from('contacts')
            .update({
              full_name: updatedName,
              first_name: extractFirstName(updatedName)
            })
            .eq('id', contact.id)
            .select('*')
            .single();

          if (error) {
            return { ok: false, error: error.message };
          }

          return { ok: true, created: false, contact: data };
        }
      }

      return { ok: true, created: false, contact };
    }

    const insertData = {
      full_name: normalizeName(fullName),
      first_name: extractFirstName(fullName),
      phone: normalizedPhone,
      whatsapp: normalizedPhone,
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert(insertData)
      .select('*')
      .single();

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, created: true, contact: data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function safeParseBudget(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value).replace(/[^0-9]/g, '');
  if (!cleaned) return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function uniq(arr = []) {
  return Array.from(new Set(arr));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeReply(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return '{}';
  }
}

async function createAgentFollowup(supabase, data) {
  const payload = {
    conversation_id: data.conversation_id,
    lead_id: data.lead_id || null,
    request_type: data.request_type,
    summary: data.summary,
    priority: data.priority || 'medium',
    status: 'pending',
    assigned_to_agent_profile_id: data.assigned_to_agent_profile_id || null,
    created_by_system: true
  };

  const { data: result, error } = await supabase
    .from('agent_followup_requests')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('createAgentFollowup error:', error);
    return null;
  }

  return result;
}

function getPublicPropertyUrl(property) {
  if (!property || typeof property !== 'object') return null;

  if (property.canonical_url) {
    return property.canonical_url;
  }

  if (property.slug) {
    return `https://luxetty.com/propiedad/${property.slug}`;
  }

  if (property.listing_id) {
    return `https://luxetty.com/propiedad/${property.listing_id}`;
  }

  return null;
}

function splitLuxettyLinksFromMessage(message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const urlMatches = [...text.matchAll(/https?:\/\/(?:www\.)?luxetty\.com\/[^\s)]+/gi)];
  if (!urlMatches.length) {
    const normalized = sanitizeReply(text);
    return normalized ? [normalized] : [];
  }

  const urls = urlMatches.map((match) => String(match[0] || '').trim()).filter(Boolean);
  const textWithoutUrls = sanitizeReply(
    text
      .replace(/https?:\/\/(?:www\.)?luxetty\.com\/[^\s)]+/gi, ' ')
      .replace(/[👉]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const result = [];
  if (textWithoutUrls) result.push(textWithoutUrls);
  urls.forEach((url) => result.push(url));
  return result;
}

function normalizeOutboundMessages(reply) {
  const items = Array.isArray(reply) ? reply : [reply];
  const result = [];

  for (const item of items) {
    const split = splitLuxettyLinksFromMessage(item);
    split.forEach((message) => {
      if (message) result.push(message);
    });
  }

  return result;
}

/**
 * Busca el profile_id del Agente Especial por email en user_profiles.
 * No hardcodea UUID: usa el email como identificador estable.
 * Retorna null si no se encuentra o hay error.
 */
async function lookupSpecialAgentProfileId(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', 'agente.especial@luxetty.com')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('LOOKUP_SPECIAL_AGENT_ERROR', { error: error.message });
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('LOOKUP_SPECIAL_AGENT_FATAL', { error: err?.message });
    return null;
  }
}

module.exports = {
  normalizeWhatsApp,
  normalizePhoneNumber,
  normalizeName,
  extractFirstName,
  findContactByWhatsApp,
  createContactFromConversation,
  findOrCreateContact,
  safeParseBudget,
  uniq,
  nowIso,
  sanitizeReply,
  safeJsonStringify,
  createAgentFollowup,
  getPublicPropertyUrl,
  extractWhatsAppReferral,
  splitLuxettyLinksFromMessage,
  normalizeOutboundMessages,
  lookupSpecialAgentProfileId,
};
