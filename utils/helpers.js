// utils/helpers.js

function normalizeWhatsApp(input) {
  if (input == null) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');

  if (!digits) return null;

  // Caso MX: 10 dígitos → agregar 52
  if (digits.length === 10) {
    digits = `52${digits}`;
  }

  // Caso válido MX con lada
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+${digits}`;
  }

  return null;
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

module.exports = {
  normalizeWhatsApp,
  normalizeName,
  extractFirstName,
  findContactByWhatsApp,
  createContactFromConversation,
  findOrCreateContact,
  safeParseBudget,
  uniq,
  nowIso,
  sanitizeReply,
  safeJsonStringify
};