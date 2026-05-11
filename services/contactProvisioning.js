const {
  normalizePhoneNumber,
  buildPhoneLookupValues,
  isUsefulContactName,
  isInvalidContactName,
  splitContactName,
} = require('../utils/helpers');

function normalizeCandidateNames(waName, state = {}) {
  const names = [waName, state?.full_name]
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim())
    .filter(Boolean);

  const usefulName = names.find((name) => isUsefulContactName(name) && !isInvalidContactName(name)) || null;
  const rejectedNames = usefulName ? [] : names;
  return { usefulName, rejectedNames };
}

async function ensureContactForConversationCore({
  supabase,
  conversationRow,
  state,
  phone,
  waName = null,
  source = 'whatsapp',
  rawPayload = null,
  saveConversationEvent,
  updateConversationMeta,
}) {
  try {
    if (!conversationRow?.id || !phone) return null;

    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const { usefulName, rejectedNames } = normalizeCandidateNames(waName, state);

    if (rejectedNames.length > 0) {
      await saveConversationEvent(conversationRow.id, 'contact_name_rejected', {
        source,
        normalized_phone: normalizedPhone,
        rejected_names: rejectedNames.slice(0, 3),
      });
    }

    let existingContact = null;

    if (conversationRow.contact_id) {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', conversationRow.contact_id)
        .maybeSingle();
      existingContact = data || null;
    }

    if (!existingContact) {
      const { data: byWhatsapp } = await supabase
        .from('contacts')
        .select('*')
        .eq('whatsapp', normalizedPhone)
        .limit(1);
      existingContact = byWhatsapp?.[0] || null;
    }

    if (!existingContact) {
      const { data: byPhone } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', normalizedPhone)
        .limit(1);
      existingContact = byPhone?.[0] || null;
    }

    if (!existingContact) {
      const lookupValues = buildPhoneLookupValues(normalizedPhone);
      const orFilter = lookupValues
        .flatMap((value) => [`phone.eq.${value}`, `whatsapp.eq.${value}`])
        .join(',');
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(orFilter)
        .limit(1);
      existingContact = data?.[0] || null;
    }

    if (existingContact) {
      const payload = {};
      const existingDisplay =
        [existingContact.first_name, existingContact.last_name].filter(Boolean).join(' ').trim() ||
        existingContact.full_name ||
        '';
      const placeholderFirst = /^cliente$/i.test(String(existingContact.first_name || '').trim());
      const shouldApplyName =
        usefulName &&
        (!isUsefulContactName(existingDisplay) || placeholderFirst);

      if (shouldApplyName) {
        const nameParts = splitContactName(usefulName);
        payload.first_name = nameParts.firstName;
        payload.last_name = nameParts.lastName;
        payload.name_source = 'whatsapp_meta';
      }
      if (!existingContact.phone) payload.phone = normalizedPhone;
      if (!existingContact.whatsapp) payload.whatsapp = normalizedPhone;
      if (!existingContact.phone_normalized) payload.phone_normalized = normalizedPhone;
      if (!existingContact.whatsapp_normalized) payload.whatsapp_normalized = normalizedPhone;

      if (Object.keys(payload).length > 0) {
        await supabase.from('contacts').update(payload).eq('id', existingContact.id);
      }

      if (shouldApplyName) {
        await saveConversationEvent(conversationRow.id, 'contact_provisional_enriched', {
          contact_id: existingContact.id,
          source,
          normalized_phone: normalizedPhone,
          applied_name: usefulName,
        });
      }

      if (!conversationRow.contact_id || conversationRow.contact_id !== existingContact.id) {
        await updateConversationMeta(conversationRow.id, {
          contact_id: existingContact.id,
        });
      }

      await saveConversationEvent(conversationRow.id, 'contact_reused', {
        contact_id: existingContact.id,
        source,
        normalized_phone: normalizedPhone,
      });

      return existingContact.id;
    }

    const { firstName: newContactFirstName, lastName: newContactLastName } =
      splitContactName(usefulName || 'Cliente');
    const createPayload = {
      first_name: newContactFirstName,
      last_name: newContactLastName,
      phone: normalizedPhone,
      whatsapp: normalizedPhone,
      phone_normalized: normalizedPhone,
      whatsapp_normalized: normalizedPhone,
      name_source: usefulName ? 'whatsapp_meta' : 'auto_placeholder',
      created_source: 'ai_agent',
      created_channel: 'whatsapp',
    };

    const { data: created, error } = await supabase
      .from('contacts')
      .insert(createPayload)
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return null;
    }

    await updateConversationMeta(conversationRow.id, {
      contact_id: created.id,
    });

    await saveConversationEvent(conversationRow.id, 'contact_created', {
      contact_id: created.id,
      source,
      normalized_phone: normalizedPhone,
      has_useful_name: !!usefulName,
      raw_payload_meta_message_id: rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || null,
    });

    return created.id;
  } catch (err) {
    console.error('FATAL ensureContactForConversation:', err);
    return null;
  }
}

module.exports = {
  ensureContactForConversationCore,
};

